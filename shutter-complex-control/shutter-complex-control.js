module.exports = function (RED)
{
    function ShutterComplexControlNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smartContext = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        // used from text-exec node
        if (typeof config.exec_text_names == "string")
            node.exec_text_names = config.exec_text_names.split(",").map(n => n.trim().toLowerCase());
        else
            node.exec_text_names = [];

        // persistent values
        var nodeSettings = Object.assign({}, {
            last_position: 0,        // 0 = opened, 100 = closed
            last_direction_up: true, // remember last direction for toggle action
        }, smartContext.get(node.id));

        // dynamic config
        let max_time = parseInt(config.max_time || 60);
        let revert_time_ms = parseInt(config.revert_time_ms || 100);
        let alarm_action = config.alarm_action || "NOTHING";

        // runtime values
        let max_time_timeout = null;
        let on_time = null;
        let off_time = null;
        let wait_for_up = false;
        let wait_for_down = false;
        let wait_timeout = null;
        let alarm_active = false;

        // central handling
        var event = "node:" + config.id;
        var handler = function (msg)
        {
            node.receive(msg);
        }
        RED.events.on(event, handler);


        node.on("input", function (msg)
        {
            handleTopic(msg);

            smartContext.set(node.id, nodeSettings);
        });

        node.on("close", function ()
        {
            stopAutoOff();
            RED.events.off(event, handler);
        });

        let handleTopic = msg =>
        {
            var resultUp = false;
            var resultDown = false;
            var resultStop = false;

            let realTopic = helper.getTopicName(msg.topic);

            // set default topic if invalid value is send
            if (!["up", "up_stop", "down", "down_stop", "stop", "toggle", "up_down", "position", "alarm"].includes(realTopic))
                realTopic = "toggle";

            // skip if button is released
            if (msg.payload === false && ["up", "up_stop", "down", "down_stop", "stop", "toggle"].includes(realTopic))
                return;

            // Convert up_down from HA UI to next command
            if (realTopic == "up_down")
            {
                if (msg.payload)
                    realTopic = "down";
                else
                    realTopic = "up";
            }

            // Correct next topic to avoid handling up_stop, down_stop or toggle separately.
            if (max_time_timeout != null && (realTopic == "up_stop" || realTopic == "down_stop" || realTopic == "toggle"))
            {
                realTopic = "stop";
            }
            else if (max_time_timeout == null)
            {
                // shutter is not running, set next command depending on topic
                if (realTopic == "up_stop")
                    realTopic = "up";
                else if (realTopic == "down_stop")
                    realTopic = "down";
                else if (nodeSettings.last_direction_up && realTopic == "toggle")
                    realTopic = "down";
                else if (!nodeSettings.last_direction_up && realTopic == "toggle")
                    realTopic = "up";
            }

            // console.log("Convert topic to: " + realTopic);

            switch (realTopic)
            {
                case "up":
                    if (max_time_timeout != null)
                    {
                        // Nothing todo
                        if (nodeSettings.last_direction_up)
                            return;

                        // Runs down at the moment, so stop first
                        if (nodeSettings.last_direction_up == false)
                        {
                            // console.log("--- Sub topic ---");
                            handleTopic({ topic: "stop" });
                            // console.log("-----------------");
                        }
                    }

                    on_time = Date.now();
                    resultUp = true;
                    startAutoOff(false, helper.getTimeInMsFromString(msg.time_on) || null);
                    if (!alarm_active)
                        node.status({ fill: "green", shape: "dot", text: "Up" });
                    break;

                case "stop":
                    if (alarm_active)
                        break;

                    resultStop = true;
                    if (max_time_timeout != null)
                    {
                        const change_percentage = (Date.now() - on_time) / 1000 / max_time * 100;
                        if (nodeSettings.last_direction_up)
                            nodeSettings.last_position = Math.max(0, nodeSettings.last_position - change_percentage);
                        else
                            nodeSettings.last_position = Math.min(100, nodeSettings.last_position + change_percentage);
                    }
                    off_time = Date.now();
                    stopAutoOff();
                    node.status({ fill: "red", shape: "dot", text: "Stopped at " + Math.round(nodeSettings.last_position) + "%" });
                    break;

                case "down":
                    if (max_time_timeout != null)
                    {
                        // Nothing todo
                        if (nodeSettings.last_direction_up == false)
                            return;

                        // Runs up at the moment, so stop first
                        if (nodeSettings.last_direction_up)
                        {
                            // console.log("--- Sub topic ---");
                            handleTopic({ topic: "stop" });
                            // console.log("-----------------");
                        }
                    }

                    on_time = Date.now();
                    resultDown = true;
                    startAutoOff(true, helper.getTimeInMsFromString(msg.time_on) || null);
                    if (!alarm_active)
                        node.status({ fill: "green", shape: "dot", text: "Down" });
                    break;

                case "position":
                    if (alarm_active)
                        break;

                    let value = parseFloat(msg.payload);

                    if (value < 0) value = 0;
                    if (value > 100) value = 100;

                    const now = Date.now();

                    if (max_time_timeout != null)
                    {
                        // Change position while running,
                        // Calculate current position first
                        const change_percentage = (now - on_time) / 1000 / max_time * 100;
                        if (nodeSettings.last_direction_up)
                            nodeSettings.last_position = Math.max(0, nodeSettings.last_position - change_percentage);
                        else
                            nodeSettings.last_position = Math.min(100, nodeSettings.last_position + change_percentage);

                        node.status({ fill: "gray", shape: "dot", text: "Update current position to " + nodeSettings.last_position + "%" });

                        // Runs in the wrong direction at the moment, so stop first
                        if (nodeSettings.last_direction_up && value > nodeSettings.last_position)
                        {
                            // console.log("--- Sub topic ---");
                            handleTopic({ topic: "stop" });
                            // console.log("-----------------");
                        }
                        else if (nodeSettings.last_direction_up == false && value < nodeSettings.last_position)
                        {
                            // console.log("--- Sub topic ---");
                            handleTopic({ topic: "stop" });
                            // console.log("-----------------");
                        }
                    }

                    on_time = now;

                    if (value < nodeSettings.last_position)
                    {
                        // Go up
                        resultUp = true;
                        startAutoOff(false, (nodeSettings.last_position - value) / 100 * max_time * 1000, value);
                    }
                    else if (value > nodeSettings.last_position)
                    {
                        // Go down
                        resultDown = true;
                        startAutoOff(true, (value - nodeSettings.last_position) / 100 * max_time * 1000, value);
                    }
                    else
                    {
                        // Really an exact match
                        handleTopic({ topic: "stop" });
                        return;
                    }

                    node.status({ fill: "green", shape: "dot", text: "Set position from " + nodeSettings.last_position + "%  to " + value + "%" });
                    break;

                case "alarm":
                    alarm_active = msg.payload;

                    if (alarm_active)
                    {
                        node.status({ fill: "red", shape: "dot", text: "ALARM is active" });

                        switch (alarm_action)
                        {
                            case "UP":
                                handleTopic({ topic: "up" });
                                break;

                            case "DOWN":
                                handleTopic({ topic: "down" });
                                break;
                        }
                    }
                    break;
            }

            sendResult(resultUp, resultDown, resultStop);
        };

        let startAutoOff = (down, wait_time_ms = null, new_position = null) =>
        {
            // console.log("startAutoOff (" + down + ", " + wait_time_ms + ", " + new_position + ");");

            // Stop if any timeout is set
            stopAutoOff();

            if (new_position != null)
            {
                // use normal times for top or bottom position
                if (new_position == 0)
                {
                    new_position = null;
                    down = false;
                }
                else if (new_position == 100)
                {
                    new_position = null;
                    down = true;
                }
            }
            if (wait_time_ms == null)
            {
                if (down)
                    wait_time_ms = (100 - nodeSettings.last_position) * max_time / 100 * 1000;
                else
                    wait_time_ms = nodeSettings.last_position * max_time / 100 * 1000;

                // Run at least for 5 seconds
                if (wait_time_ms < 5000)
                    wait_time_ms = 5000;
            }

            max_time_on = parseInt(wait_time_ms / 1000);

            if (wait_time_ms < 0)
            {
                node.status({ fill: "red", shape: "dot", text: "time_on value has to be greater than 0" });
                return;
            }

            if (!alarm_active)
                node.status({ fill: "yellow", shape: "ring", text: (down ? "Down" : "Up") + ", wait " + helper.formatMsToStatus(max_time_on, "until") + " for auto off" });

            max_time_timeout = setTimeout(() =>
            {
                handleTopic({ topic: "stop" });
                if (new_position != null)
                    nodeSettings.last_position = new_position;
                smartContext.set(node.id, nodeSettings);
            }, wait_time_ms);
        };

        let stopAutoOff = () =>
        {
            if (max_time_timeout != null)
            {
                // console.log("stopAutoOff");
                if (!alarm_active)
                    node.status({ fill: "green", shape: "dot", text: "Stopped at " + Math.round(nodeSettings.last_position) + "%" });
                clearTimeout(max_time_timeout);
                off_time = Date.now();
                max_time_timeout = null;
            }
        };

        let sendResult = (up, down, stop) =>
        {
            // console.log("sendResult(" + up + ", " + down + ", " + stop + ");");
            if ((up && wait_for_down) || (down && wait_for_up))
            {
                // console.log("Stop wait timeout");
                clearTimeout(wait_timeout);
                wait_timeout = null;
            }

            let now = Date.now();
            if (off_time + revert_time_ms > now)
            {
                // Output has to possibly wait until the revert time has passed
                if ((nodeSettings.last_direction_up && down) || (nodeSettings.last_direction_up == false && up))
                {
                    // console.log("Start wait timeout for " + (off_time + revert_time_ms - now) + "ms");

                    if (off_time + revert_time_ms - now > revert_time_ms)
                        return;

                    wait_timeout = setTimeout(() =>
                    {
                        wait_timeout = null;
                        sendResult(up, down, stop);
                    }, off_time + revert_time_ms - now);
                    return;
                }
            }

            if (stop && wait_timeout != null)
            {
                clearTimeout(wait_timeout);
                wait_timeout = null;
            }

            // console.log("really sendResult(" + up + ", " + down + ", " + stop + ");");
            if (up)
            {
                if (!alarm_active || alarm_action === "UP")
                {
                    nodeSettings.last_direction_up = true;
                    node.send([{ payload: true }, { payload: false }, { payload: nodeSettings.last_position }]);
                    notifyCentral(true);
                }
            }
            else if (down)
            {
                if (!alarm_active || alarm_action === "DOWN")
                {
                    nodeSettings.last_direction_up = false;
                    node.send([{ payload: false }, { payload: true }, { payload: nodeSettings.last_position }]);
                    notifyCentral(true);
                }
            }
            else if (stop && !alarm_active)
            {
                node.send([{ payload: false }, { payload: false }, { payload: nodeSettings.last_position }]);
                notifyCentral(false);
            }
        };

        let notifyCentral = state =>
        {
            if (!config.links)
                return;

            config.links.forEach(link =>
            {
                RED.events.emit("node:" + link, { source: node.id, state: state });
            });
        };

        // For security reason, stop shutter at node start
        setTimeout(() =>
        {
            node.send([{ payload: false }, { payload: false }, { payload: nodeSettings.last_position }]);
            node.status({ fill: "red", shape: "dot", text: "Stopped at " + Math.round(nodeSettings.last_position) + "%" });
            notifyCentral(false);
        }, 10000);
    }

    RED.nodes.registerType("smart_shutter-complex-control", ShutterComplexControlNode);
};
