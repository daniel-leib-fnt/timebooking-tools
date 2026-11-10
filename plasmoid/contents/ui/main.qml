import QtQuick
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasma5support as P5Support
import org.kde.plasma.plasmoid

import "worktime.js" as Worktime

PlasmoidItem {
    id: root

    readonly property string statusCommand: 'cat "${XDG_STATE_HOME:-$HOME/.local/state}/timebooking/status.json"'

    readonly property var texts: Qt.locale().name.startsWith("de") ? {
        clockIn: "Einstempeln",
        clockOut: "Ausstempeln",
        clockedIn: "Eingestempelt",
        notClockedIn: "Nicht eingestempelt",
        noBookings: "Heute keine Buchungen",
        lastUpdate: "Letzte Aktualisierung",
        checking: "Prüfe Status bei GFOS …",
        statusUnreadable: "Statusdatei nicht lesbar",
        notConfirmed: "Nicht von GFOS bestätigt (lokaler Stand)",
        refresh: "Von GFOS aktualisieren"
    } : {
        clockIn: "Clock in",
        clockOut: "Clock out",
        clockedIn: "Clocked in",
        notClockedIn: "Not clocked in",
        noBookings: "No bookings today",
        lastUpdate: "Last update",
        checking: "Checking status at GFOS …",
        statusUnreadable: "Status file not readable",
        notConfirmed: "Not confirmed by GFOS (local state)",
        refresh: "Refresh from GFOS"
    }

    // Parsed status.json; null until the first successful read.
    property var status: null
    property bool busy: false
    property bool refreshing: false
    property string actionError: ""
    property date now: new Date()

    readonly property bool isToday: status !== null && status.date === Qt.formatDate(now, "yyyy-MM-dd")
    readonly property bool clockedIn: isToday && status.clockedIn
    readonly property var intervals: isToday ? status.intervals : []
    readonly property bool stampedToday: intervals.length > 0
    readonly property string netText: stampedToday ? Worktime.format(Worktime.netSeconds(intervals, now)) : "-:--"
    readonly property color netColor: !stampedToday ? "#000000" : clockedIn ? Kirigami.Theme.positiveTextColor : Kirigami.Theme.negativeTextColor
    readonly property string warning: {
        if (actionError) return actionError;
        if (status === null) return texts.statusUnreadable;
        if (status.lastError) return status.lastError;
        if (status.source === "local") return texts.notConfirmed;
        return "";
    }
    // Stamping needs a state GFOS confirmed within the last minute: a stale state sends the wrong direction.
    readonly property bool fresh: status !== null && status.source === "gfos" && !status.lastError
        && now - new Date(status.updatedAt) < 60 * 1000
    readonly property bool canStamp: !busy && !refreshing && fresh

    function intervalLines() {
        if (intervals.length === 0) return texts.noBookings;
        return intervals.map(iv => iv.in + " – " + (iv.out || "…")).join("\n");
    }

    // Runs a shell command; onDone(exitCode, stdout, stderr) is called when it finishes.
    property var pending: ({})
    function run(command, onDone) {
        pending[command] = onDone;
        executable.connectSource(command);
    }

    function readStatus() {
        run(statusCommand, (code, stdout) => {
            if (code !== 0) {
                status = null;
                return;
            }
            try {
                status = JSON.parse(stdout);
            } catch (e) {
                status = null;
            }
        });
    }

    function refreshFromGfos() {
        refreshing = true;
        run("timebooking status --json", () => {
            refreshing = false;
            readStatus();
        });
    }

    function book(clockIn) {
        if (!canStamp) return;
        busy = true;
        actionError = "";
        run("timebooking " + (clockIn ? "clock-in" : "clock-out") + " --notify", (code, stdout, stderr) => {
            busy = false;
            if (code !== 0) {
                actionError = (stderr || stdout || ("exit code " + code)).trim();
            }
            readStatus();
        });
    }

    onExpandedChanged: {
        if (expanded) {
            actionError = "";
            refreshFromGfos();
        }
    }

    P5Support.DataSource {
        id: executable
        engine: "executable"
        onNewData: (sourceName, data) => {
            const onDone = root.pending[sourceName];
            delete root.pending[sourceName];
            disconnectSource(sourceName);
            if (onDone) onDone(data["exit code"], data["stdout"], data["stderr"]);
        }
    }

    Timer {
        interval: 1000
        running: true
        repeat: true
        onTriggered: root.now = new Date()
    }
    // The CLI writes status.json on every call, also from the console; reading it is cheap.
    Timer {
        interval: 5 * 1000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.readStatus()
    }
    // Retries sooner while the last refresh failed, e.g. until the VPN is connected.
    Timer {
        interval: root.status !== null && root.status.lastError ? 30 * 1000 : 5 * 60 * 1000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.refreshFromGfos()
    }

    Plasmoid.icon: "chronometer"
    preferredRepresentation: compactRepresentation
    toolTipMainText: (clockedIn ? texts.clockedIn : texts.notClockedIn) + " – " + netText
    toolTipSubText: {
        let text = intervalLines();
        if (status !== null) text += "\n\n" + texts.lastUpdate + ": " + Qt.formatTime(new Date(status.updatedAt), "HH:mm:ss");
        if (warning) text += "\n\n⚠ " + warning;
        return text;
    }

    Plasmoid.contextualActions: [
        PlasmaCore.Action {
            text: root.texts.refresh
            icon.name: "view-refresh"
            onTriggered: root.refreshFromGfos()
        }
    ]

    compactRepresentation: MouseArea {
        Layout.minimumWidth: row.implicitWidth
        Layout.preferredWidth: row.implicitWidth
        onClicked: root.expanded = !root.expanded

        RowLayout {
            id: row
            anchors.centerIn: parent
            spacing: Kirigami.Units.smallSpacing

            PlasmaComponents.Label {
                id: timeLabel
                text: root.netText
                font.bold: true
                font.features: { "tnum": 1 }
                color: root.netColor
                opacity: root.busy ? 0.4 : blink

                // Blinks permanently while clocked out after stamping today.
                property real blink: 1
                SequentialAnimation on blink {
                    running: root.stampedToday && !root.clockedIn
                    loops: Animation.Infinite
                    NumberAnimation { to: 0.15; duration: 500 }
                    NumberAnimation { to: 1; duration: 500 }
                    onStopped: timeLabel.blink = 1
                }
            }
            Kirigami.Icon {
                visible: root.warning !== ""
                source: "dialog-warning"
                Layout.preferredWidth: Kirigami.Units.iconSizes.small
                Layout.preferredHeight: Kirigami.Units.iconSizes.small
            }
        }
    }

    fullRepresentation: ColumnLayout {
        Layout.minimumWidth: Kirigami.Units.gridUnit * 12
        spacing: Kirigami.Units.smallSpacing

        Kirigami.Heading {
            level: 2
            text: root.netText
            color: root.netColor
        }
        PlasmaComponents.Label {
            text: root.intervalLines()
        }
        RowLayout {
            visible: root.refreshing || root.busy
            PlasmaComponents.BusyIndicator {
                Layout.preferredWidth: Kirigami.Units.iconSizes.small
                Layout.preferredHeight: Kirigami.Units.iconSizes.small
            }
            PlasmaComponents.Label {
                text: root.texts.checking
            }
        }
        PlasmaComponents.Label {
            visible: root.warning !== "" && !root.refreshing
            text: "⚠ " + root.warning
            wrapMode: Text.Wrap
            Layout.fillWidth: true
        }
        PlasmaComponents.Button {
            text: root.clockedIn ? root.texts.clockOut : root.texts.clockIn
            icon.name: root.clockedIn ? "media-playback-stop" : "media-playback-start"
            enabled: root.canStamp
            onClicked: root.book(!root.clockedIn)
        }
    }
}
