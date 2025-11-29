# Changelog

## Version 0.3.28:

-   Added this changlog file.
-   Separate values for shutter_complex node for up and down times.
    (Open each node and save it, to use the new times. This should be done before the version 0.4.0 is released.)
-   For the following nodes you can choose to have one or two outputs (Could be a **breaking change**, please check your nodes).

    -   Logic
    -   Compare
    -   Hysteresis

-   You can now separately declare the messages that should be sent by the following nodes (Could be a **breaking change**, please check your nodes).

    -   Logic
    -   Compare
    -   Hysteresis

-   You can choose for the following nodes if they should send the result all the time or only if the result changed.
    -   Logic
    -   Compare
    -   Hysteresis

## Version 0.3.29:

-   Fixed that hysteresis sends only on change, when separate outputs are enabled.
-   Added a definable short up/down time for the shutter control.
-   Fixed calculation of the time from string.

## Version 0.3.30:

-   Added counter example.

## Version 0.3.31:

-   Fixed logic node - invert output option.

## Version 0.3.32:

-   Fixed hysteresis node - always change result.

## Version 0.3.33:

-   Fixed hysteresis node - init send.

## Version 0.3.34:

-   Fixed hysteresis node - init send.
-   Fixed light node - status.

## Version 0.3.35:

-   Fixed saving last message object as a clone of the original message, because it could be changed later.

## Version 0.3.36:

-   Fixed mixing-valve - call of toFixed function.

## Version 0.3.37:

-   Fixed using typedInput with node-red v4.
-   Started to add English translations.

## Version 0.4.0:

-   Fully added English and German translations.
-   Light control: Added Alarm off action
-   Shutter complex control: Added Alarm off action
-   Restructured the complete code
-   Improved status texts
-   **breaking change** (soon): Changed some node internal values. Please open and save the following node types:

    -   Central node
    -   Compare node
    -   Counter node
    -   Hysteresis node
    -   Shutter complex node
    -   Statistic node

    After saving the nodes, the values are automatically converted to the new one.
    This conversion will be removed in version 0.5.0.

## Version 0.4.1:

-   Show only up to 2 decimal places in node status text.
-   Improved warn messages shown in console.

## Version 0.4.2:

-   Fixed design of property page of forwarder node.
-   Corrected hysteresis to send original message.

## Version 0.4.3:

-   Corrected hysteresis (again) to send original message.

## Version 0.4.4:

-   Fixed the delay node to not restart the time if "only on change" option is enabled.

## Version 0.4.5:

-   Fixed the status of hysteresis node.

## Version 0.4.6:

-   Fixed the status of hysteresis node.

## Version 0.4.7:

-   Added blink topic to light node.

## Version 0.4.8:

-   Fixed reading values in heating-curve node.

## Version 0.4.9:

-   Fixed reading config values for offset and slope in heating-curve node.

## Version 0.4.10:

-   **breaking change** (soon): Added common and separate outputs to multi press node.
    Please open node config and save it to make sure it will work in later versions.
-   Added common and separate outputs to long press node.

## Version 0.4.11:

-   Fixed long press default outputs.

## Version 0.4.12:

-   Fixed text exec node.

## Version 0.4.13:

-   Fixed text exec node again.

## Version 0.4.14:

-   Removed log outputs.

## Version 0.4.15:

-   Reverted some tests.

## Version 0.4.16:

-   Reverted some tests.

## Version 0.4.17:

-   Fixed mixing-valve position calculation.
-   Fixed up_down message for central node.

## Version 0.4.18:

-   Fixed up_down message for central node.

## Version 0.4.19:

-   Added min_change_time option to mixing-valve node.

## Version 0.4.20:

-   Small bugfix.

## Version 0.4.21:

-   Fixed up_down direction in central node..

## Version 0.4.22:

-   Added set_state_inverted topic to forwarder node.

## Version 0.4.23:

-   Added set_state_inverted topic to mixing-valve node.
-   Added set_state_inverted topic to scheduler node.
-   Changed default of save_state and resend_on_start to false for all nodes.
-   Hysteresis node can now be defined by min/max values.
-   Added support for percentage output for the light node.

## Version 0.4.24:

-   Added set_inverted to light node.

## Version 0.4.25:

-   Changed some texts.

## Version 0.4.26:

-   Added possibility to control mixing-valve nodes from central node.

## Version 0.4.27:

-   Fixed central node.

## Version 0.4.28:

-   Added on and off topic to mixing-valve.

## Version 0.5.0:

-   Improved light control percentage status text.
-   Fixed logic node when common outputs is configured but one value is set to "send nothing".
-   mixing-valve can now output as percentage directly or with open/close impulses.
-   mixing-valve tries to guess the best position, when getting enabled.
-   Added debug topic to all nodes, to see current values.
-   Added new node "mode-selector".

## Version 0.5.1:

-   To be more compatible, topic "set" is also possible instead of "set_state". Same for "set_inverted" instead of "set_state_inverted".

## Version 0.5.2:

-   Added alarm mode to mixing-valve.

## Version 0.6.0:

-   Reduced amount of messages sent by light node when it is in alarm mode.
-   Fixed forwarder node causing an error when no topic was sent.
-   Added Jest example for all nodes to be able to debug nodes in vscode.

## Version 0.6.1:

- Removed some ui limits of mixing-valve.

## Version 0.6.2:

- Cached runtime config is revoked now, when new settings are applied in the web frontend.
- Removed feature from mixing-valve to automatically start with the best known position, because it hadn't worked as expected.

## Version 0.6.3:

- Fixed bug, when disabling mixing-valve while it is opening, the off mode close was not handled. Same for closing and off mode open.

## Version 0.6.4:

- Do off mode for the full time, in case the real position dismatch the known position in the node.