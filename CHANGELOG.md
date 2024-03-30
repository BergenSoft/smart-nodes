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
