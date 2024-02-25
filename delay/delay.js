module.exports = function (RED)
{
    function DelayNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smartContext = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        var nodeSettings = {
            on_delay_ms: helper.getTimeInMs(config.on_delay, config.on_delay_unit),
            off_delay_ms: helper.getTimeInMs(config.off_delay, config.off_delay_unit),
            lastMessage: null,
        };

        if (config.save_state)
        {
            // load old saved values
            nodeSettings = Object.assign(nodeSettings, smartContext.get(node.id));

            switch (nodeSettings.lastMessage?.payload)
            {
                case true:
                    node.status({ fill: "yellow", shape: "ring", text: (new Date()).toLocaleString() + ": " + "Load last state: On" });
                    break;

                case false:
                    node.status({ fill: "yellow", shape: "ring", text: (new Date()).toLocaleString() + ": " + "Load last state: Off" });
                    break;

                default:
                    node.status({ fill: "yellow", shape: "ring", text: (new Date()).toLocaleString() + ": " + "No last state available" });
                    break;
            }
        }
        else
        {
            // delete old saved values
            node.status({});
            smartContext.del(node.id);
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
                    nodeSettings.on_delay_ms = helper.getTimeInMsFromString(msg.payload);
                    node.status({ fill: "yellow", shape: "ring", text: (new Date()).toLocaleString() + ": " + "New on delay: " + helper.formatMsToStatus(nodeSettings.on_delay_ms) });

                    if (config.save_state)
                        smartContext.set(node.id, nodeSettings);
                    break;

                case "set_delay_off":
                    nodeSettings.off_delay_ms = helper.getTimeInMsFromString(msg.payload);
                    node.status({ fill: "yellow", shape: "ring", text: (new Date()).toLocaleString() + ": " + "New off delay: " + helper.formatMsToStatus(nodeSettings.on_delay_ms) });

                    if (config.save_state)
                        smartContext.set(node.id, nodeSettings);
                    break;

                case "set_delays":
                    nodeSettings.on_delay_ms = helper.getTimeInMsFromString(msg.payload);
                    nodeSettings.off_delay_ms = nodeSettings.on_delay_ms;
                    node.status({ fill: "yellow", shape: "ring", text: (new Date()).toLocaleString() + ": " + "New delays: " + helper.formatMsToStatus(nodeSettings.on_delay_ms) });

                    if (config.save_state)
                        smartContext.set(node.id, nodeSettings);
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
            let delayMs = 0;

            if (msg.payload)
                delayMs = nodeSettings.on_delay_ms;
            else
                delayMs = nodeSettings.off_delay_ms;

            if (delay_only_on_change)
            {
                if (timeout != null)
                {
                    // current delay runs already for the same payload, so don't start a new one.
                    if (next_payload == msg.payload)
                        return;

                    // payload changed back to last value => stop current delay
                    if (nodeSettings.lastMessage?.payload == msg.payload)
                    {
                        node.status({ fill: "yellow", shape: "dot", text: (new Date()).toLocaleString() + ": " + "Stopped delayed message" });
                        clearTimeout(timeout);
                        timeout = null;

                        return;
                    }
                }
                // payload hasn't changed
                else if (nodeSettings.lastMessage?.payload == msg.payload)
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
            if (delayMs <= 0)
            {
                node.status({ fill: "yellow", shape: "dot", text: (new Date()).toLocaleString() + ": " + "Sended msg.topic = '" + +msg.topic + "' msg.payload = '" + msg.payload + "'" });
                nodeSettings.lastMessage = msg

                if (config.save_state)
                    smartContext.set(node.id, nodeSettings);

                node.send(msg);
                return;
            }

            // start new timeout
            node.status({ fill: "yellow", shape: "ring", text: (new Date()).toLocaleString() + ": " + "Forward msg.topic = '" + msg.topic + "' msg.payload = '" + msg.payload + "' in " + helper.formatMsToStatus(delayMs, "at") });
            timeout = setTimeout(() =>
            {
                timeout = null;
                node.status({ fill: "yellow", shape: "dot", text: (new Date()).toLocaleString() + ": " + "Sended msg.topic = '" + msg.topic + "' msg.payload = '" + msg.payload + "'" });
                nodeSettings.lastMessage = msg

                if (config.save_state)
                    smartContext.set(node.id, nodeSettings);

                node.send(msg);
            }, delayMs);
        }

        if (config.save_state && config.resend_on_start && nodeSettings.lastMessage != null)
        {
            setTimeout(() =>
            {
                node.status({ fill: "yellow", shape: "dot", text: (new Date()).toLocaleString() + ": " + "Sended msg.topic = '" + nodeSettings.lastMessage.topic + "' msg.payload = '" + nodeSettings.lastMessage.payload + "'" });
                node.send(nodeSettings.lastMessage);
            }, 10000);
        }
    }

    RED.nodes.registerType("smart_delay", DelayNode);
}
