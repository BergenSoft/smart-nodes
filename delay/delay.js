module.exports = function (RED)
{
    "use strict";

    function DelayNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        var node_settings = {
            on_delay_ms: helper.getTimeInMs(config.on_delay, config.on_delay_unit),
            off_delay_ms: helper.getTimeInMs(config.off_delay, config.off_delay_unit),
            last_message: null,
        };

        if (config.save_state)
        {
            // load old saved values
            node_settings = Object.assign(node_settings, smart_context.get(node.id));

            switch (node_settings.last_message?.payload)
            {
                case true:
                    node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": " + "Load last state: On" });
                    break;

                case false:
                    node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": " + "Load last state: Off" });
                    break;

                default:
                    node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": " + "No last state available" });
                    break;
            }
        }
        else
        {
            // delete old saved values
            node.status({});
            smart_context.del(node.id);
        }

        // dynamic config
        let delay_only_on_change = config.delay_only_on_change;

        // runtime values
        let timeout = null;
        let next_payload = null;

        node.on("input", function (msg)
        {
            switch (msg.topic)
            {
                case "set_delay_on":
                    node_settings.on_delay_ms = helper.getTimeInMsFromString(msg.payload);
                    node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": " + "New on delay: " + helper.formatMsToStatus(node_settings.on_delay_ms) });

                    if (config.save_state)
                        smart_context.set(node.id, node_settings);
                    break;

                case "set_delay_off":
                    node_settings.off_delay_ms = helper.getTimeInMsFromString(msg.payload);
                    node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": " + "New off delay: " + helper.formatMsToStatus(node_settings.on_delay_ms) });

                    if (config.save_state)
                        smart_context.set(node.id, node_settings);
                    break;

                case "set_delays":
                    node_settings.on_delay_ms = helper.getTimeInMsFromString(msg.payload);
                    node_settings.off_delay_ms = node_settings.on_delay_ms;
                    node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": " + "New delays: " + helper.formatMsToStatus(node_settings.on_delay_ms) });

                    if (config.save_state)
                        smart_context.set(node.id, node_settings);
                    break;

                default:
                    send(msg);
                    break;
            }
        });

        node.on("close", function ()
        {
            if (timeout != null)
            {
                clearTimeout(timeout);
                timeout = null;
            }
        });

        let send = (msg) =>
        {
            let delay_ms = 0;

            if (msg.payload)
                delay_ms = node_settings.on_delay_ms;
            else
                delay_ms = node_settings.off_delay_ms;

            if (delay_only_on_change)
            {
                if (timeout != null)
                {
                    // current delay runs already for the same payload, so don't start a new one.
                    if (next_payload == msg.payload)
                        return;

                    // payload changed back to last value => stop current delay
                    if (node_settings.last_message?.payload == msg.payload)
                    {
                        node.status({ fill: "yellow", shape: "dot", text: helper.getCurrentTimeForStatus() + ": " + "Stopped delayed message" });
                        clearTimeout(timeout);
                        timeout = null;

                        return;
                    }
                }
                // payload hasn't changed
                else if (node_settings.last_message?.payload == msg.payload)
                {
                    return;
                }
            }

            // stop timeout if any
            if (timeout != null)
            {
                node.status({});
                clearTimeout(timeout);
                timeout = null;
            }

            // No delay if 0 or smaller
            if (delay_ms <= 0)
            {
                node.status({ fill: "yellow", shape: "dot", text: helper.getCurrentTimeForStatus() + ": " + "Sended msg.topic = '" + +msg.topic + "' msg.payload = '" + msg.payload + "'" });
                node_settings.last_message = msg

                if (config.save_state)
                    smart_context.set(node.id, node_settings);

                node.send(msg);
                return;
            }

            // start new timeout
            node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": " + "Forward msg.topic = '" + msg.topic + "' msg.payload = '" + msg.payload + "' in " + helper.formatMsToStatus(delay_ms, "at") });
            timeout = setTimeout(() =>
            {
                timeout = null;
                node.status({ fill: "yellow", shape: "dot", text: helper.getCurrentTimeForStatus() + ": " + "Sended msg.topic = '" + msg.topic + "' msg.payload = '" + msg.payload + "'" });
                node_settings.last_message = msg

                if (config.save_state)
                    smart_context.set(node.id, node_settings);

                node.send(msg);
            }, delay_ms);
        }

        if (config.save_state && config.resend_on_start && node_settings.last_message != null)
        {
            setTimeout(() =>
            {
                node.status({ fill: "yellow", shape: "dot", text: helper.getCurrentTimeForStatus() + ": " + "Sended msg.topic = '" + node_settings.last_message.topic + "' msg.payload = '" + node_settings.last_message.payload + "'" });
                node.send(node_settings.last_message);
            }, 10000);
        }
    }

    RED.nodes.registerType("smart_delay", DelayNode);
}
