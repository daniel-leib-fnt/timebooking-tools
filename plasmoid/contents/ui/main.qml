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

    // Parsed status.json; null until the first successful read.
    property var status: null
    property bool busy: false
    property string actionError: ""
    property date now: new Date()

    readonly property bool isToday: status !== null && status.date === Qt.formatDate(now, "yyyy-MM-dd")
    readonly property bool clockedIn: isToday && status.clockedIn
    readonly property var intervals: isToday ? status.intervals : []
    readonly property string netText: Worktime.format(Worktime.netSeconds(intervals, now))
    readonly property string warning: {
        if (actionError) return actionError;
        if (status === null) return "Status file not readable";
        if (status.lastError) return status.lastError;
        if (status.source === "local") return "Not confirmed by GFOS (local state)";
        return "";
    }

    function intervalLines() {
        if (intervals.length === 0) return "No bookings today";
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
        run("timebooking status --json", () => readStatus());
    }

    function book(clockIn) {
        if (busy) return;
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
    Timer {
        interval: 30 * 1000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.readStatus()
    }
    Timer {
        interval: 5 * 60 * 1000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.refreshFromGfos()
    }

    Plasmoid.icon: "chronometer"
    preferredRepresentation: compactRepresentation
    toolTipMainText: (clockedIn ? "Clocked in" : "Not clocked in") + " – " + netText
    toolTipSubText: {
        let text = intervalLines();
        if (status !== null) text += "\n\nLast update: " + Qt.formatTime(new Date(status.updatedAt), "HH:mm:ss");
        if (warning) text += "\n\n⚠ " + warning;
        return text;
    }

    Plasmoid.contextualActions: [
        PlasmaCore.Action {
            text: "Clock in"
            icon.name: "media-playback-start"
            enabled: !root.busy && !root.clockedIn
            onTriggered: root.book(true)
        },
        PlasmaCore.Action {
            text: "Clock out"
            icon.name: "media-playback-stop"
            enabled: !root.busy && root.clockedIn
            onTriggered: root.book(false)
        },
        PlasmaCore.Action {
            text: "Refresh from GFOS"
            icon.name: "view-refresh"
            onTriggered: root.refreshFromGfos()
        }
    ]

    compactRepresentation: MouseArea {
        Layout.minimumWidth: row.implicitWidth
        Layout.preferredWidth: row.implicitWidth
        acceptedButtons: Qt.LeftButton | Qt.MiddleButton
        onClicked: mouse => {
            if (mouse.button === Qt.MiddleButton) root.expanded = !root.expanded;
            else root.book(!root.clockedIn);
        }

        RowLayout {
            id: row
            anchors.centerIn: parent
            spacing: Kirigami.Units.smallSpacing

            PlasmaComponents.Label {
                id: timeLabel
                text: root.netText
                font.bold: true
                font.features: { "tnum": 1 }
                color: root.clockedIn ? Kirigami.Theme.positiveTextColor : Kirigami.Theme.negativeTextColor
                opacity: root.busy ? 0.4 : blink

                // Blinks permanently while not clocked in.
                property real blink: 1
                SequentialAnimation on blink {
                    running: !root.clockedIn
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
            color: root.clockedIn ? Kirigami.Theme.positiveTextColor : Kirigami.Theme.negativeTextColor
        }
        PlasmaComponents.Label {
            text: root.intervalLines()
        }
        PlasmaComponents.Label {
            visible: root.warning !== ""
            text: "⚠ " + root.warning
            wrapMode: Text.Wrap
            Layout.fillWidth: true
        }
        RowLayout {
            PlasmaComponents.Button {
                text: "Clock in"
                icon.name: "media-playback-start"
                enabled: !root.busy && !root.clockedIn
                onClicked: root.book(true)
            }
            PlasmaComponents.Button {
                text: "Clock out"
                icon.name: "media-playback-stop"
                enabled: !root.busy && root.clockedIn
                onClicked: root.book(false)
            }
        }
    }
}
