module.exports = function (RED)
{
    "use strict";

    function CentralControlNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        // runtime values
        let states = new Map();

        // listen to all events sended directly to this node
        let event = "node:" + config.id;
        let handler = function (msg)
        {
            if (typeof msg.source == "undefined" || typeof msg.state == "undefined")
            {
                console.warn("Unknown message received in smart_node central", msg);
                return;
            }

            // Save feedback from linked node
            states.set(msg.source, msg.state);

            if (isAllOff())
                node.status({ fill: "red", shape: "dot", text: "All off" });
            else
                node.status({ fill: "green", shape: "dot", text: "Something is on" });
        }
        RED.events.on(event, handler);

        node.status({});

        node.on("input", function (msg)
        {
            // copy message, so original message stays unchanged
            let new_msg = Object.assign({}, msg);

            // make connected nodes behavior homogenous
            switch (config.mode)
            {
                case "shutter":
                    if (msg.topic == "up_stop")
                    {
                        if (isAllOff())
                            new_msg.topic = "up";
                        else
                            new_msg.topic = "stop";
                    }
                    else if (msg.topic == "down_stop")
                    {
                        if (isAllOff())
                            new_msg.topic = "down";
                        else
                            new_msg.topic = "stop";
                    }
                    break;

                case "light":
                    if (msg.topic == "toggle")
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
                // console.log(node.id + " -> " + link);
                // console.log(newMsg);
                RED.events.emit("node:" + link, new_msg);
            });
        });

        node.on("close", function ()
        {
            // Cleanup event listener
            RED.events.removeListener(event, handler);
        });

        // This functions return true if all lights are off or all shutter are stopped
        let isAllOff = () =>
        {
            for (let [key, state] of states)
            {
                if (state)
                    return false;
            }

            return true;
        }
    }
    RED.nodes.registerType("smart_central-control", CentralControlNode);
};
