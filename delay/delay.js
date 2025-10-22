const smart_helper = require("../smart_helper.js");

module.exports = function (RED)
{
    "use strict";

    function DelayNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);


        // ###################
        // # Class constants #
        // ###################


        // #######################
        // # Global help objects #
        // #######################
        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");


        // #####################
        // # persistent values #
        // #####################
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


        // ##################
        // # Dynamic config #
        // ##################
        let delay_only_on_change = config.delay_only_on_change;


        // ##################
        // # Runtime values #
        // ##################

        // Here the setTimeout return value is stored to send the delayed message.
        let timeout = null;

        // Saves the next payload that needs to be send.
        // This is used to avoid restarting the timeout for the same payload.
        let next_payload = null;


        // ###############
        // # Node events #
        // ###############
        node.on("input", function (msg)
        {
            handleTopic(msg);

            // setStatus();

            if (config.save_state)
                smart_context.set(node.id, node_settings);
        });

        node.on("close", function ()
        {
            if (timeout != null)
            {
                clearTimeout(timeout);
                timeout = null;
            }
        });


        // #####################
        // # Private functions #
        // #####################

        // This is the main function which handles all topics that was received.
        let handleTopic = msg =>
        {
            let real_topic = helper.getTopicName(msg.topic);

            switch (real_topic)
            {
                case "debug":
                    helper.nodeDebug(node, {
                        node_settings,
                        delay_only_on_change,
                    });
                    break;

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
        }

        let send = msg =>
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
                    if ((next_payload ?? node_settings.last_message?.payload) == msg.payload)
                        return;

                    // payload changed back to last value => stop current delay
                    if (node_settings.last_message?.payload == msg.payload)
                    {
                        next_payload = null;
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
                next_payload = null;
                node.status({ fill: "yellow", shape: "dot", text: helper.getCurrentTimeForStatus() + ": " + "Sended " + getMessageStatusText(msg) });
                node_settings.last_message = helper.cloneObject(msg);

                node.send(node_settings.last_message);
                return;
            }

            // start new timeout
            node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": " + "Forward " + getMessageStatusText(msg) + " in " + helper.formatMsToStatus(delay_ms, "at") });
            next_payload = msg.payload;
            timeout = setTimeout(() =>
            {
                timeout = null;
                next_payload = null;

                node.status({ fill: "yellow", shape: "dot", text: helper.getCurrentTimeForStatus() + ": " + "Sended " + getMessageStatusText(msg) });
                node_settings.last_message = helper.cloneObject(msg);

                node.send(node_settings.last_message);

                if (config.save_state)
                    smart_context.set(node.id, node_settings);

            }, delay_ms);
        }

        let getMessageStatusText = msg =>
        {
            let text = "";
            if (msg.topic != null)
                text += " topic = '" + msg.topic + "'";
            if (msg.payload != null)
                text += " payload = '" + msg.payload + "'";

            if (text == "")
                return "a message";

            return text.trim();
        }

        if (config.save_state && config.resend_on_start && node_settings.last_message != null)
        {
            setTimeout(() =>
            {
                node.status({ fill: "yellow", shape: "dot", text: helper.getCurrentTimeForStatus() + ": " + "Sended " + getMessageStatusText(node_settings.last_message) });
                node.send(helper.cloneObject(node_settings.last_message));
            }, 10000);
        }
    }

    RED.nodes.registerType("smart_delay", DelayNode);
}
