module.exports = function (RED)
{
    function ForwarderNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smartContext = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        var nodeSettings = {
            enabled: config.enabled,
            lastMessage: null,
            last_msg_was_sended: true
        };

        if (config.save_state)
        {
            // load old saved values
            nodeSettings = Object.assign(nodeSettings, smartContext.get(node.id));
        }
        else
        {
            // delete old saved values
            smartContext.del(node.id);
        }

        // dynamic config
        let forwardTrue = config.always_forward_true;
        let forwardFalse = config.always_forward_false;
        let forward_last_on_enable = config.forward_last_on_enable;

        // runtime values


        node.on("input", function (msg)
        {
            let newState = null;
            if (msg.topic == "enable" || (msg.topic == "set_state" && msg.payload))
                newState = true;
            else if (msg.topic == "disable" || (msg.topic == "set_state" && !msg.payload))
                newState = false;

            // Already the correct state
            if (newState != null && nodeSettings.enabled == newState)
                return;

            switch (newState)
            {
                case true:
                case false:
                    nodeSettings.enabled = newState;

                    if (config.save_state)
                        smartContext.set(node.id, nodeSettings);

                    if (nodeSettings.enabled && forward_last_on_enable && nodeSettings.lastMessage != null && !nodeSettings.last_msg_was_sended)
                    {
                        node.send(nodeSettings.lastMessage);
                        nodeSettings.last_msg_was_sended = true;
                    }

                    setStatus();
                    break;

                default:
                    // Forward if enabled or forced
                    if (nodeSettings.enabled || (forwardTrue && msg.payload) || (forwardFalse && !msg.payload))
                    {
                        node.send(msg);
                        nodeSettings.last_msg_was_sended = true;
                    }
                    else
                    {
                        nodeSettings.last_msg_was_sended = false;
                    }

                    nodeSettings.lastMessage = msg;
                    break;
            }
        });

        let setStatus = () =>
        {
            if (nodeSettings.enabled)
                node.status({ fill: "green", shape: "dot", text: "Forwarding enabled" });
            else
                node.status({ fill: "red", shape: "dot", text: "Forwarding disabled" });
        }

        setStatus();
    }

    RED.nodes.registerType("smart_forwarder", ForwarderNode);
}
