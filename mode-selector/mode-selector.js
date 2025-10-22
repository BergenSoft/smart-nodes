module.exports = function (RED)
{
    "use strict";

    function ModeSelectorNode(config)
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
        var node_settings = helper.cloneObject({
            last_mode: null,
        }, smart_context.get(node.id));


        // ##################
        // # Dynamic config #
        // ##################
        let mode_items = (config.mode_items || [{ name: "NO_MODES_DEFINED" }]).map(m => m.name);


        // ##################
        // # Runtime values #
        // ##################


        // ###############
        // # Node events #
        // ###############
        node.on("input", function (msg)
        {
            handleTopic(msg);

            setStatus();

            smart_context.set(node.id, node_settings);
        });

        node.on("close", function ()
        {
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
                        node_settings
                    });
                    break;

                case "set_mode":
                    {
                        let selectedIndex = mode_items.indexOf(msg.payload);
                        if (selectedIndex === -1)
                        {
                            node.warn("set_mode: invalid payload, mode '" + msg.payload + "' not found");
                            break;
                        }

                        // No change, don't send anything
                        if (node_settings.last_mode == msg.payload)
                            break;

                        node_settings.last_mode = msg.payload;
                        smart_context.set(node.id, node_settings);
                        sendCurrentMode();
                    }
                    break;

                case "refresh":
                    sendCurrentMode();
                    break;

                default:
                    break;
            }
        }

        let sendCurrentMode = () =>
        {
            const result = mode_items.map((m, idx) =>
            {
                return { payload: (m === node_settings.last_mode) };
            });

            node.send(result);
        }

        let setStatus = () =>
        {
            node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": " + node_settings.last_mode });
        }

        if (node_settings.last_mode == null && mode_items.length > 0)
        {
            node_settings.last_mode = mode_items[0];
            smart_context.set(node.id, node_settings);
        }

        if (config.resend_on_start)
        {
            setTimeout(() =>
            {
                sendCurrentMode();
            }, 10000);
        }

        setStatus();
    }

    RED.nodes.registerType("smart_mode-selector", ModeSelectorNode);
}
