module.exports = function (RED)
{
    "use strict";

    function ForwarderNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        var node_settings = {
            enabled: config.enabled,
            last_message: null,
            last_msg_was_sended: true
        };

        if (config.save_state)
        {
            // load old saved values
            node_settings = Object.assign(node_settings, smart_context.get(node.id));
        }
        else
        {
            // delete old saved values
            smart_context.del(node.id);
        }

        // dynamic config
        let forward_true = config.always_forward_true;
        let forward_false = config.always_forward_false;
        let forward_last_on_enable = config.forward_last_on_enable;

        // runtime values


        node.on("input", function (msg)
        {
            let new_state = null;
            if (msg.topic == "enable" || (msg.topic == "set_state" && msg.payload))
                new_state = true;
            else if (msg.topic == "disable" || (msg.topic == "set_state" && !msg.payload))
                new_state = false;

            // Already the correct state
            if (new_state != null && node_settings.enabled == new_state)
                return;

            switch (new_state)
            {
                case true:
                case false:
                    node_settings.enabled = new_state;

                    if (config.save_state)
                        smart_context.set(node.id, node_settings);

                    if (node_settings.enabled && forward_last_on_enable && node_settings.last_message != null && !node_settings.last_msg_was_sended)
                    {
                        node.send(node_settings.last_message);
                        node_settings.last_msg_was_sended = true;
                    }

                    setStatus();
                    break;

                default:
                    // Forward if enabled or forced
                    if (node_settings.enabled || (forward_true && msg.payload) || (forward_false && !msg.payload))
                    {
                        node.send(msg);
                        node_settings.last_msg_was_sended = true;
                    }
                    else
                    {
                        node_settings.last_msg_was_sended = false;
                    }

                    node_settings.last_message = helper.cloneObject(msg);;
                    break;
            }
        });

        let setStatus = () =>
        {
            if (node_settings.enabled)
                node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Forwarding enabled" });
            else
                node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Forwarding disabled" });
        }

        if (config.save_state && config.resend_on_start && node_settings.last_message != null)
        {
            setTimeout(() =>
            {
                node.send(node_settings.last_message);
            }, 10000);
        }

        setStatus();
    }

    RED.nodes.registerType("smart_forwarder", ForwarderNode);
}
