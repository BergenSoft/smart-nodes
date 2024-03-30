module.exports = function (RED)
{
    "use strict";

    function ShutterComplexControlNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        // used from text-exec node
        if (typeof config.exec_text_names == "string")
            node.exec_text_names = config.exec_text_names.split(",").map(n => n.trim().toLowerCase());
        else
            node.exec_text_names = [];

        // persistent values
        var node_settings = Object.assign({}, {
            last_position: 0,        // 0 = opened, 100 = closed
            last_direction_up: true, // remember last direction for toggle action
        }, smart_context.get(node.id));

        // Backward compatibility
        if (typeof config.max_time != "undefined")
        {
            config.max_time_up = config.max_time;
            config.max_time_down = config.max_time;
            delete config.max_time;
        }

        // dynamic config
        let max_time_up = parseInt(config.max_time_up || 60);
        let max_time_down = parseInt(config.max_time_down || 60);
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

            smart_context.set(node.id, node_settings);
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

            let real_topic = helper.getTopicName(msg.topic);

            // set default topic if invalid value is send
            if (!["up", "up_stop", "down", "down_stop", "stop", "toggle", "up_down", "position", "alarm"].includes(real_topic))
                real_topic = "toggle";

            // skip if button is released
            if (msg.payload === false && ["up", "up_stop", "down", "down_stop", "stop", "toggle"].includes(real_topic))
                return;

            // Convert up_down from HA UI to next command
            if (real_topic == "up_down")
            {
                if (msg.payload)
                    real_topic = "down";
                else
                    real_topic = "up";
            }

            // Correct next topic to avoid handling up_stop, down_stop or toggle separately.
            if (max_time_timeout != null && (real_topic == "up_stop" || real_topic == "down_stop" || real_topic == "toggle"))
            {
                real_topic = "stop";
            }
            else if (max_time_timeout == null)
            {
                // shutter is not running, set next command depending on topic
                if (real_topic == "up_stop")
                    real_topic = "up";
                else if (real_topic == "down_stop")
                    real_topic = "down";
                else if (node_settings.last_direction_up && real_topic == "toggle")
                    real_topic = "down";
                else if (!node_settings.last_direction_up && real_topic == "toggle")
                    real_topic = "up";
            }

            // console.log("Convert topic to: " + real_topic);

            switch (real_topic)
            {
                case "up":
                    if (max_time_timeout != null)
                    {
                        // Nothing todo
                        if (node_settings.last_direction_up)
                            return;

                        // Runs down at the moment, so stop first
                        if (node_settings.last_direction_up == false)
                        {
                            // console.log("--- Sub topic ---");
                            handleTopic({ topic: "stop" });
                            // console.log("-----------------");
                        }
                    }

                    on_time = Date.now();
                    resultUp = true;
                    startAutoOff(false, helper.getTimeInMsFromString(msg.time_on) || null, null, msg.exact);
                    break;

                case "stop":
                    if (alarm_active)
                        break;

                    resultStop = true;
                    if (max_time_timeout != null)
                    {
                        if (node_settings.last_direction_up)
                        {
                            const change_percentage = (Date.now() - on_time) / 1000 / max_time_up * 100;
                            node_settings.last_position = Math.max(0, node_settings.last_position - change_percentage);
                        }
                        else
                        {
                            const change_percentage = (Date.now() - on_time) / 1000 / max_time_down * 100;
                            node_settings.last_position = Math.min(100, node_settings.last_position + change_percentage);
                        }
                    }
                    off_time = Date.now();
                    stopAutoOff();
                    break;

                case "down":
                    if (max_time_timeout != null)
                    {
                        // Nothing todo
                        if (node_settings.last_direction_up == false)
                            return;

                        // Runs up at the moment, so stop first
                        if (node_settings.last_direction_up)
                        {
                            // console.log("--- Sub topic ---");
                            handleTopic({ topic: "stop" });
                            // console.log("-----------------");
                        }
                    }

                    on_time = Date.now();
                    resultDown = true;
                    startAutoOff(true, helper.getTimeInMsFromString(msg.time_on) || null, null, msg.exact);
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
                        if (node_settings.last_direction_up)
                        {
                            const change_percentage = (now - on_time) / 1000 / max_time_up * 100;
                            node_settings.last_position = Math.max(0, node_settings.last_position - change_percentage);
                        }
                        else
                        {
                            const change_percentage = (now - on_time) / 1000 / max_time_down * 100;
                            node_settings.last_position = Math.min(100, node_settings.last_position + change_percentage);
                        }

                        // Runs in the wrong direction at the moment, so stop first
                        if (node_settings.last_direction_up && value > node_settings.last_position)
                        {
                            // console.log("--- Sub topic ---");
                            handleTopic({ topic: "stop" });
                            // console.log("-----------------");
                        }
                        else if (node_settings.last_direction_up == false && value < node_settings.last_position)
                        {
                            // console.log("--- Sub topic ---");
                            handleTopic({ topic: "stop" });
                            // console.log("-----------------");
                        }
                    }

                    on_time = now;

                    if (value < node_settings.last_position)
                    {
                        // Go up
                        resultUp = true;
                        startAutoOff(false, (node_settings.last_position - value) / 100 * max_time_up * 1000, value);
                    }
                    else if (value > node_settings.last_position)
                    {
                        // Go down
                        resultDown = true;
                        startAutoOff(true, (value - node_settings.last_position) / 100 * max_time_down * 1000, value);
                    }
                    else
                    {
                        // Really an exact match
                        handleTopic({ topic: "stop" });
                        return;
                    }
                    break;

                case "alarm":
                    alarm_active = msg.payload;

                    if (alarm_active)
                    {
                        node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": ALARM turned on" });

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
                    else
                    {
                        node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": ALARM turned off" });
                    }
                    break;
            }

            sendResult(resultUp, resultDown, resultStop, msg.exact);
        };

        let startAutoOff = (down, wait_time_ms = null, new_position = null, exact = false) =>
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
                    wait_time_ms = (100 - node_settings.last_position) * max_time_down / 100 * 1000;
                else
                    wait_time_ms = node_settings.last_position * max_time_up / 100 * 1000;

                if (exact !== true)
                {
                    // Run at least for 5 seconds
                    if (wait_time_ms < 5000)
                        wait_time_ms = 5000;
                }
            }

            if (wait_time_ms < 0)
            {
                node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": time_on value has to be greater than 0" });
                return;
            }

            if (wait_time_ms == 0)
                return;

            if (!alarm_active)
                node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": " + (down ? "Down" : "Up") + ", wait " + helper.formatMsToStatus(wait_time_ms, "until") + " for auto off" });

            max_time_timeout = setTimeout(() =>
            {
                handleTopic({ topic: "stop" });
                if (new_position != null)
                    node_settings.last_position = new_position;
                smart_context.set(node.id, node_settings);
            }, wait_time_ms);
        };

        let stopAutoOff = () =>
        {
            if (max_time_timeout != null)
            {
                // console.log("stopAutoOff");
                if (!alarm_active)
                    node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Stopped at " + Math.round(node_settings.last_position) + "%" });
                clearTimeout(max_time_timeout);
                off_time = Date.now();
                max_time_timeout = null;
            }
        };

        let sendResult = (up, down, stop, exact) =>
        {
            if (exact === true)
            {
                console.log({ up, down, stop, exact, last_pos: node_settings.last_position });
                // Don't start moving if exact is enabled and already on top/bottom.
                if (down && node_settings.last_position == 100)
                    return;
                if (up && node_settings.last_position == 0)
                    return;
            }

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
                if ((node_settings.last_direction_up && down) || (node_settings.last_direction_up == false && up))
                {
                    // console.log("Start wait timeout for " + (off_time + revert_time_ms - now) + "ms");

                    if (off_time + revert_time_ms - now > revert_time_ms)
                        return;

                    wait_timeout = setTimeout(() =>
                    {
                        wait_timeout = null;
                        sendResult(up, down, stop, exact);
                    }, off_time + revert_time_ms - now);
                    return;
                }
            }

            if (stop && wait_timeout != null)
            {
                clearTimeout(wait_timeout);
                wait_timeout = null;
            }

            // console.log("really sendResult(" + up + ", " + down + ", " + stop + ", " + exact + ");");
            if (up)
            {
                if (!alarm_active || alarm_action === "UP")
                {
                    node_settings.last_direction_up = true;
                    node.send([{ payload: true }, { payload: false }, { payload: node_settings.last_position }]);
                    notifyCentral(true);
                    node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Up" });
                }
            }
            else if (down)
            {
                if (!alarm_active || alarm_action === "DOWN")
                {
                    node_settings.last_direction_up = false;
                    node.send([{ payload: false }, { payload: true }, { payload: node_settings.last_position }]);
                    notifyCentral(true);
                    node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Down" });
                }
            }
            else if (stop && !alarm_active)
            {
                node.send([{ payload: false }, { payload: false }, { payload: node_settings.last_position }]);
                notifyCentral(false);
                node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Stopped at " + Math.round(node_settings.last_position) + "%" });
            }
        };

        let notifyCentral = state =>
        {
            if (!config.links)
                return;

            config.links.forEach(link =>
            {
                // console.log(node.id + " -> " + link);
                // console.log({ source: node.id, state: state });
                RED.events.emit("node:" + link, { source: node.id, state: state });
            });
        };

        // For security reason, stop shutter at node start
        wait_timeout = setTimeout(() =>
        {
            node.send([{ payload: false }, { payload: false }, { payload: node_settings.last_position }]);
            node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Stopped at " + Math.round(node_settings.last_position) + "%" });
            notifyCentral(false);
        }, 10000);
    }

    RED.nodes.registerType("smart_shutter-complex-control", ShutterComplexControlNode);
};
