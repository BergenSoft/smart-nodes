module.exports = function (RED)
{
    "use strict";

    function CentralControlNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        // ###################
        // # Class constants #
        // ###################
        const MODE_LIGHT = "LIGHT"
        const MODE_SHUTTER = "SHUTTER";


        // #######################
        // # Global help objects #
        // #######################
        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");


        // #####################
        // # persistent values #
        // #####################
        // Not used from this node


        // ##################
        // # Dynamic config #
        // ##################
        let mode = config.mode?.toUpperCase() ?? MODE_LIGHT;


        // ##################
        // # Runtime values #
        // ##################

        // This map saves the state of all connected nodes.
        // The key is the node id of the connected node.
        let states = new Map();


        // #########################
        // # Central node handling #
        // #########################
        let event = "node:" + config.id;
        let handler = function (msg)
        {
            if (typeof msg.source == "undefined" || typeof msg.state == "undefined")
            {
                helper.warn(this, "Unknown message received in smart_node central.", msg);
                return;
            }

            // Save feedback from linked node
            states.set(msg.source, msg.state);
            setStatus();
        }
        RED.events.on(event, handler);


        node.on("input", function (msg)
        {
            handleTopic(msg);

            setStatus();
        });

        node.on("close", function ()
        {
            // Cleanup event listener
            RED.events.removeListener(event, handler);
        });


        // #####################
        // # Private functions #
        // #####################

        // This is the main function which handles all topics that was received.
        let handleTopic = msg =>
        {
            // copy message, so original message stays unchanged
            let new_msg = helper.cloneObject(msg);

            let real_topic = helper.getTopicName(msg.topic);

            // make connected nodes behavior homogenous
            switch (mode)
            {
                case MODE_SHUTTER:
                    if (real_topic == "up_stop")
                    {
                        if (isAllOff())
                            new_msg.topic = "up";
                        else
                            new_msg.topic = "stop";
                    }
                    else if (real_topic == "down_stop")
                    {
                        if (isAllOff())
                            new_msg.topic = "down";
                        else
                            new_msg.topic = "stop";
                    }
                    break;

                case MODE_LIGHT:
                    if (real_topic == "toggle")
                    {
                        if (isAllOff())
                            new_msg.topic = "on";
                        else
                            new_msg.topic = "off";
                    }
                    break;
            }

            // Send cloned message to all linked nodes
            config.links.forEach(link =>
            {
                helper.log(node.id + " -> " + link);
                helper.log(new_msg);
                RED.events.emit("node:" + link, new_msg);
            });
        }

        /**
         * This functions return true if all lights are off or all shutter are stopped
         * @returns true if all is off
         */
        let isAllOff = () =>
        {
            for (let [key, state] of states)
            {
                if (state)
                    return false;
            }

            return true;
        }

        /**
         * Set the current node status
         */
        let setStatus = () =>
        {
            if (isAllOff())
                node.status({ fill: "red", shape: "dot", text: "central.status.all_off" });
            else
                node.status({ fill: "green", shape: "dot", text: "central.status.Something_is_on" });
        }
    }
    RED.nodes.registerType("smart_central-control", CentralControlNode);
};
