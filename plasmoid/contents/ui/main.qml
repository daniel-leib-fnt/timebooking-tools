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

    // The CLI caches the GFOS days per year; today is in the current year's file.
    readonly property string cacheCommand: 'cat "${XDG_STATE_HOME:-$HOME/.local/state}/timebooking/days/$(date +%Y).json"'

    readonly property var texts: Qt.locale().name.startsWith("de") ? {
        clockIn: "Einstempeln",
        clockOut: "Ausstempeln",
        clockedIn: "Eingestempelt",
        notClockedIn: "Nicht eingestempelt",
        noBookings: "Heute keine Buchungen",
        lastUpdate: "Letzte Aktualisierung",
        checking: "Prüfe Status bei GFOS …",
        statusUnreadable: "Noch keine Daten von GFOS – Popup öffnen",
        refresh: "Von GFOS aktualisieren"
    } : {
        clockIn: "Clock in",
        clockOut: "Clock out",
        clockedIn: "Clocked in",
        notClockedIn: "Not clocked in",
        noBookings: "No bookings today",
        lastUpdate: "Last update",
        checking: "Checking status at GFOS …",
        statusUnreadable: "No data from GFOS yet – open the popup",
        refresh: "Refresh from GFOS"
    }

    // Parsed days/<yyyy>.json; null until the first successful read.
    property var cache: null
    property bool busy: false
    property bool refreshing: false
    property string actionError: ""
    property date now: new Date()

    readonly property var today: cache !== null ? cache.days[Qt.formatDate(now, "yyyy-MM-dd")] ?? null : null
    readonly property var intervals: today !== null && today.day !== null ? today.day.intervals : []
    readonly property bool clockedIn: intervals.length > 0 && intervals[intervals.length - 1].out === null
    readonly property string lastError: cache !== null && cache.lastError ? cache.lastError.message : ""
    readonly property bool stampedToday: intervals.length > 0
    readonly property string netText: stampedToday ? Worktime.format(Worktime.netSeconds(intervals, now)) : "-:--"
    readonly property color netColor: !stampedToday ? "#000000" : clockedIn ? Kirigami.Theme.positiveTextColor : Kirigami.Theme.negativeTextColor
    readonly property string warning: {
        if (actionError) return actionError;
        if (lastError) return lastError;
        if (today === null) return texts.statusUnreadable;
        return "";
    }
    // Stamping needs a state GFOS confirmed within the last minute: a stale state sends the wrong direction.
    // A "local" entry holds a punch GFOS confirmed, so it counts as fresh as well.
    readonly property bool fresh: today !== null && !lastError && now - new Date(today.fetchedAt) < 60 * 1000
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

    function readCache() {
        run(cacheCommand, (code, stdout) => {
            if (code !== 0) {
                cache = null;
                return;
            }
            try {
                cache = JSON.parse(stdout);
            } catch (e) {
                cache = null;
            }
        });
    }

    // Reads today from GFOS into the cache; stdout is not used, only the error.
    function refreshFromGfos() {
        refreshing = true;
        actionError = "";
        run("timebooking status", (code, stdout, stderr) => {
            refreshing = false;
            if (code !== 0) {
                actionError = (stderr || ("exit code " + code)).trim();
            }
            readCache();
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
            readCache();
        });
    }

    // GFOS is only contacted when the popup opens, from the context menu and when stamping.
    onExpandedChanged: {
        if (expanded) {
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
    // Every CLI and MCP call that reads GFOS updates the cache file, also from the console.
    Timer {
        interval: 10 * 1000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.readCache()
    }

    Plasmoid.icon: "chronometer"
    preferredRepresentation: compactRepresentation
    toolTipMainText: (clockedIn ? texts.clockedIn : texts.notClockedIn) + " – " + netText
    toolTipSubText: {
        let text = intervalLines();
        if (today !== null) text += "\n\n" + texts.lastUpdate + ": " + Qt.formatTime(new Date(today.fetchedAt), "HH:mm:ss");
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
