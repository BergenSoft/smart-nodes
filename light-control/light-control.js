module.exports = function (RED)
{
    function LightControlNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smartContext = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        // persistent values
        var nodeSettings = Object.assign({}, {
            last_value: false,
        }, smartContext.get(node.id));

        // dynamic config
        let max_time_on = helper.getTimeInMs(config.max_time_on, config.max_time_on_unit);
        let alarm_action = config.alarm_action || "NOTHING";

        // runtime values
        let max_time_on_timeout = null;
        let isPermanent = false;
        let isMotion = false;
        let current_timeout_ms = 0;
        let alarm_active = false;

        // central handling
        var event = "node:" + node.id;
        var handler = function (msg)
        {
            node.receive(msg);
        }
        RED.events.on(event, handler);


        node.on("input", function (msg)
        {
            handleTopic(msg);

            setStatus();
            smartContext.set(node.id, nodeSettings);
        });

        node.on("close", function ()
        {
            stopAutoOff();
            RED.events.off(event, handler);
        });

        let handleTopic = msg =>
        {
            let doRestartTimer = true;

            switch (helper.getTopicName(msg.topic))
            {
                case "status":
                    // Make sure it is bool
                    msg.payload = !!msg.payload;
                    doRestartTimer = nodeSettings.last_value != msg.payload;

                    nodeSettings.last_value = msg.payload;
                    break;

                case "off":
                    // If button is released, don't handle this message
                    if (msg.payload === false)
                        return;

                    nodeSettings.last_value = false;
                    break;

                case "on":
                    // If button is released, don't handle this message
                    if (msg.payload === false)
                        return;

                    nodeSettings.last_value = true;
                    break;

                case "set":
                    // Make sure it is bool
                    msg.payload = !!msg.payload;
                    nodeSettings.last_value = msg.payload;
                    break;

                case "set_permanent":
                    // Make sure it is bool
                    msg.payload = !!msg.payload;
                    nodeSettings.last_value = msg.payload;
                    isPermanent = msg.payload;
                    break;

                case "motion":
                    // Make sure it is bool
                    msg.payload = !!msg.payload;
                    isMotion = msg.payload;

                    if (msg.payload == false)
                    {
                        // It already was off, so don't turn on
                        if (nodeSettings.last_value == false)
                            return;

                        // If time is set to 0, then turn off immediately
                        if (helper.getTimeInMsFromString(msg.time_on ?? max_time_on) == 0)
                            nodeSettings.last_value = false;
                    }
                    else
                    {
                        nodeSettings.last_value = true;
                    }
                    break;

                case "alarm":
                    // Make sure it is bool
                    msg.payload = !!msg.payload;
                    alarm_active = msg.payload;
                    break;

                case "toggle":
                default:
                    // If button is released, don't handle this message
                    if (msg.payload === false)
                        return;

                    nodeSettings.last_value = !nodeSettings.last_value;
                    break;
            }

            if (doRestartTimer)
                stopAutoOff();

            // Check alarm values
            if (alarm_active)
            {
                isPermanent = false;

                switch (alarm_action)
                {
                    case "ON":
                        nodeSettings.last_value = true;
                        break;

                    default:
                    case "OFF":
                        nodeSettings.last_value = false;
                        break;
                }
            }

            if (alarm_active || helper.getTopicName(msg.topic) != "status")
                node.send({ payload: nodeSettings.last_value });

            // Output is on, now
            if (nodeSettings.last_value && doRestartTimer)
                startAutoOffIfNeeded(helper.getTimeInMsFromString(msg.time_on ?? max_time_on));

            notifyCentral(nodeSettings.last_value);
        }

        let startAutoOffIfNeeded = origTimeMs =>
        {
            // No timer when alarm is active
            if (alarm_active)
                return;

            let timeMs = parseInt(origTimeMs);

            if (isNaN(timeMs))
            {
                node.error("Invalid time_on value send: " + origTimeMs);
                timeMs = max_time_on;
            }

            current_timeout_ms = timeMs;

            // Stop if any timeout is set
            stopAutoOff();

            // 0 = Always on
            if (timeMs <= 0 || isPermanent || isMotion || !nodeSettings.last_value)
                return;

            max_time_on_timeout = setTimeout(() =>
            {
                max_time_on_timeout = null;
                nodeSettings.last_value = false;
                node.send({ payload: false });
                notifyCentral(false);

                setStatus();
                smartContext.set(node.id, nodeSettings);
            }, timeMs);
        };

        let stopAutoOff = () =>
        {
            if (max_time_on_timeout != null)
            {
                clearTimeout(max_time_on_timeout);
                max_time_on_timeout = null;
            }
        };

        let setStatus = () =>
        {
            if (alarm_active)
            {
                node.status({ fill: "red", shape: "dot", text: "ALARM is active" });
            }
            else if (nodeSettings.last_value)
            {
                if (isPermanent || isMotion || current_timeout_ms <= 0)
                    node.status({ fill: "green", shape: "dot", text: "On" });
                else if (max_time_on_timeout)
                    node.status({ fill: "yellow", shape: "ring", text: "Wait " + helper.formatMsToStatus(current_timeout_ms, "until") + " for auto off" });
            }
            else
            {
                node.status({ fill: "red", shape: "dot", text: "Off" });
            }
        }

        let notifyCentral = state =>
        {
            if (!config.links)
                return;

            config.links.forEach(link =>
            {
                RED.events.emit("node:" + link, { source: node.id, state: state });
            });
        }

        setStatus();
    }

    RED.nodes.registerType("smart_light-control", LightControlNode);
};