module.exports = function (RED)
{
    "use strict";

    function LongPressControlNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);


        // ###################
        // # Class constants #
        // ###################
        const ACTION_SHORT = 0;
        const ACTION_LONG = 1;


        // #######################
        // # Global help objects #
        // #######################
        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");


        // ##################
        // # Dynamic config #
        // ##################
        let long_press_ms = helper.evaluateNodeProperty(RED, config.long_press_ms || 1000, "num");
        let short = helper.evaluateNodeProperty(RED, config.short, "json");
        let long = helper.evaluateNodeProperty(RED, config.long, "json");
        let outputs = helper.evaluateNodeProperty(RED, config.outputs, "num");


        // ##################
        // # Runtime values #
        // ##################

        // The date when the button was pressed
        let on_time = null;

        // Here the setTimeout return value is stored to detect a long press.
        let timeout = null;

        // Save the last state of the long press, this isn't needed as persistant value
        let last_action = null;


        // ###############
        // # Node events #
        // ###############
        node.on("input", function (msg)
        {
            handleTopic(msg);

            setStatus();
            // smart_context.set(node.id, node_settings);
        });

        node.on("close", function ()
        {
            stopAutoOff();
        });

        // #####################
        // # Private functions #
        // #####################

        /**
         * This is the main function which handles all topics that was received.
         */
        let handleTopic = msg =>
        {
            if (msg.payload)
            {
                on_time = Date.now();
                startAutoLongPress();
            }
            else if (on_time != null)
            {
                const pressTime = Date.now() - on_time;
                on_time = null;

                // Stop if any timeout is set
                stopAutoOff();

                if (pressTime < long_press_ms)
                {
                    last_action = ACTION_SHORT;
                    if (short != null)
                    {
                        if (outputs == 2)
                            node.send([helper.cloneObject(short), null]);
                        else
                            node.send(helper.cloneObject(short));
                    }
                }
                else
                {
                    last_action = ACTION_LONG;
                    if (long != null)
                    {
                        if (outputs == 2)
                            node.send([null, helper.cloneObject(long)]);
                        else
                            node.send(helper.cloneObject(long));

                    }
                }
            }
        }

        /**
         * Start timer to detect a long press
         */
        let startAutoLongPress = () =>
        {
            stopAutoOff();
            timeout = setTimeout(() =>
            {
                last_action = ACTION_LONG;
                on_time = null;
                timeout = null;

                if (outputs == 2)
                    node.send([null, helper.cloneObject(long)]);
                else
                    node.send(helper.cloneObject(long));

                setStatus();
            }, long_press_ms);
        };

        /**
         * Stop current runnting timer
         */
        let stopAutoOff = () =>
        {
            if (timeout != null)
            {
                clearTimeout(timeout);
                timeout = null;
            }
        };


        /**
         * Set the current node status
         */
        let setStatus = () =>
        {
            if (timeout != null)
            {
                node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": Wait for button release..." });
            }
            else
            {
                switch (last_action)
                {
                    case ACTION_SHORT:
                        node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Last was short" });
                        break;

                    case ACTION_LONG:
                        node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Last was long" });
                        break;

                    default:
                    case null:
                        node.status({});
                        break;
                }

            }
        }
    }

    RED.nodes.registerType("smart_long-press-control", LongPressControlNode);
}
