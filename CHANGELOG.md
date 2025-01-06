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
