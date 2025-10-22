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
        let previous_mode = null;
        let update_only_changed_outputs = config.update_only_changed_outputs ?? true;


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
            let [real_topic, new_mode] = msg.topic.split("#");

            switch (real_topic)
            {
                case "debug":
                    helper.nodeDebug(node, {
                        node_settings,
                        mode_items,
                        previous_mode,
                        update_only_changed_outputs
                    });
                    break;

                case "set_mode":
                    {
                        if (typeof msg.payload === "boolean")
                        {
                            // Syntax: set_mode#MODE_NAME and payload is boolean
                            // If payload is true, set to MODE_NAME
                            // if payload is false, set to default mode
                            let mode_from_topic = new_mode;
                            if (msg.payload === false)
                                new_mode = mode_items[0];

                            let selectedIndex = mode_items.indexOf(new_mode);
                            if (selectedIndex === -1)
                            {
                                node.warn("set_mode: invalid mode: '" + new_mode + "' not defined");
                                break;
                            }

                            // No change, don't send anything
                            if (node_settings.last_mode == new_mode)
                                break;

                            node_settings.last_mode = new_mode;

                            // if the given mode_from_topic was the previous mode and is turned off, now
                            // don't send turn off again
                            if (msg.payload === false && previous_mode == mode_from_topic)
                                previous_mode = null;

                            // if the given mode_from_topic is the new mode and is turned on, now
                            // don't send turn on again
                            if (msg.payload === true)
                                node_settings.last_mode = null;

                            sendCurrentMode();

                            node_settings.last_mode = new_mode;
                            previous_mode = new_mode;
                            smart_context.set(node.id, node_settings);
                        }
                        else if (typeof msg.payload === "string")
                        {
                            if (new_mode != null)
                            {
                                node.warn("set_mode: when using mode in topic, payload has to be boolean");
                                break;
                            }

                            let selectedIndex = mode_items.indexOf(msg.payload);
                            if (selectedIndex === -1)
                            {
                                node.warn("set_mode: invalid mode: '" + msg.payload + "' not defined");
                                break;
                            }

                            // No change, don't send anything
                            if (node_settings.last_mode == msg.payload)
                                break;

                            node_settings.last_mode = msg.payload;
                            smart_context.set(node.id, node_settings);
                            sendCurrentMode();
                        }
                        else
                        {
                            node.warn("set_mode: invalid payload, has to be string or boolean");
                            break;
                        }
                    }
                    break;

                case "toggle_mode":
                    {
                        let new_mode = msg.payload;
                        let selectedIndex = mode_items.indexOf(new_mode);
                        if (selectedIndex === -1)
                        {
                            node.warn("set_mode: invalid payload, mode '" + new_mode + "' not found");
                            break;
                        }

                        // No change, go to default mode
                        if (node_settings.last_mode == new_mode)
                            new_mode = mode_items[0];

                        // No change, don't send anything
                        if (node_settings.last_mode == new_mode)
                            break;

                        node_settings.last_mode = new_mode;
                        smart_context.set(node.id, node_settings);
                        sendCurrentMode();
                    }
                    break;

                case "refresh":
                    sendCurrentMode(true);
                    break;

                default:
                    break;
            }
        }

        let sendCurrentMode = (force_send_all = false) =>
        {
            let result;
            if (!force_send_all && update_only_changed_outputs)
            {
                result = mode_items.map((m, idx) =>
                {
                    if (m != node_settings.last_mode && m != previous_mode)
                        return null;

                    return { payload: (m === node_settings.last_mode) };
                });
            }
            else
            {
                result = mode_items.map((m, idx) =>
                {
                    return { payload: (m === node_settings.last_mode) };
                });
            }

            previous_mode = node_settings.last_mode;

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
