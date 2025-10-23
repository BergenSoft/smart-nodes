module.exports = function (RED)
{
    "use strict";

    function MixingValveNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);


        // ###################
        // # Class constants #
        // ###################
        const ADJUST_OPEN = 0;
        const ADJUST_CLOSE = 1;

        const OUTPUT_MODE_OPEN_CLOSE = "OPEN_CLOSE";
        const OUTPUT_MODE_PERCENTAGE = "PERCENTAGE";


        // #######################
        // # Global help objects #
        // #######################
        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");


        // #####################
        // # persistent values #
        // #####################
        var node_settings = helper.cloneObject({
            enabled: config.enabled,
            setpoint: config.setpoint,
            off_mode: config.off_mode,
            valve_mode: config.valve_mode,
            precision: config.precision || 1,
            max_change_percent: config.max_change_percent || 2,
            max_change_temp_difference: config.max_change_temp_difference || 20,
            min_change_time: config.min_change_time || 0,
            last_position: null,
        }, smart_context.get(node.id));

        // Ensure correct types
        node_settings.enabled = !!node_settings.enabled;
        node_settings.setpoint = parseFloat(node_settings.setpoint);
        if (isNaN(node_settings.setpoint) || !isFinite(node_settings.setpoint))
            node_settings.setpoint = 20;
        node_settings.precision = parseInt(node_settings.precision, 10);
        node_settings.max_change_percent = parseInt(node_settings.max_change_percent, 10);
        node_settings.max_change_temp_difference = parseInt(node_settings.max_change_temp_difference, 10);
        node_settings.min_change_time = parseInt(node_settings.min_change_time, 10);

        // ##################
        // # Dynamic config #
        // ##################
        let time_total_s = config.time_total;
        let time_sampling_s = config.time_sampling;
        let output_mode = config.output_mode || OUTPUT_MODE_OPEN_CLOSE;
        let force_position = null;
        let min_temperature = null;
        let min_temperature_position = null;
        let max_temperature = null;
        let max_temperature_position = null;
        let temp_save_date = Date.now();

        // ##################
        // # Runtime values #
        // ##################

        // Here the setInterval return value is stored which is used to recheck the valve position
        let sampling_interval = null;

        // Here the setTimeout return value is stored to stop the calibration time.
        let calibration_timeout = null;

        // Here the setTimeout return value is stored to stop the valve adjustment.
        let changing_timeout = null;

        // Store the direction of the adjustment
        let adjusting = null;

        // Stores the current temperature which is used to determine the adjusting direction
        let current_temperature = null;

        // The start time of the adjustment to count the change
        let adjusting_start_time = null;


        // #########################
        // # Central node handling #
        // #########################
        var event = "node:" + node.id;
        var handler = function (msg)
        {
            node.receive(msg);
        }
        RED.events.on(event, handler);


        // ###############
        // # Node events #
        // ###############
        node.on("input", function (msg)
        {
            handleTopic(msg);

            setStatus();
            resetSavedTemperatures();
            smart_context.set(node.id, node_settings);
        });

        node.on("close", function ()
        {
            stopSampling();

            if (sampling_interval !== null)
            {
                if (sampling_interval !== -1)
                    clearInterval(sampling_interval);

                sampling_interval = null;
            }

            if (calibration_timeout !== null)
            {
                clearTimeout(calibration_timeout);
                calibration_timeout = null;
            }

            if (changing_timeout !== null)
            {
                clearTimeout(changing_timeout);
                changing_timeout = null;
            }

            stopChanging();
        });


        // #####################
        // # Private functions #
        // #####################

        // This is the main function which handles all topics that was received.
        let handleTopic = msg =>
        {
            notifyCentral(msg.topic);

            let real_topic = helper.getTopicName(msg.topic);

            if (real_topic.startsWith("set_state"))
                real_topic = real_topic.replace("set_state", "set");

            if (real_topic == "set_inverted")
            {
                real_topic = "set";
                msg.payload = !msg.payload;
            }

            if (real_topic == "set")
                real_topic = (!!msg.payload) ? "enable" : "disable";

            switch (real_topic)
            {
                case "debug":
                    helper.nodeDebug(node, {
                        node_settings,
                        force_position,
                        current_mode: calibration_timeout !== null ? "CALIBRATION" : (changing_timeout !== null ? (adjusting == ADJUST_OPEN ? "OPENING" : "CLOSING") : "IDLE"),
                        enabled: (node_settings.enabled ? "ENABLED" : "DISABLED"),
                        heating_mode: node_settings.valve_mode,
                        current_temperature,
                        output_mode,
                        min_temperature,
                        min_temperature_position,
                        max_temperature,
                        max_temperature_position,
                    });
                    break;

                case "on":
                case "enable":
                    if (node_settings.enabled)
                    {
                        helper.log(node, "Already enabled");
                        break;
                    }

                    node_settings.enabled = true;
                    stopChanging();

                    // Set the most probable position
                    if (
                        min_temperature !== null &&
                        max_temperature !== null &&
                        min_temperature_position !== null &&
                        max_temperature_position !== null
                    )
                    {
                        let temp_range = max_temperature - min_temperature;
                        let pos_range = max_temperature_position - min_temperature_position;

                        if (
                            temp_range > 0 &&
                            pos_range !== 0 &&
                            node_settings.setpoint >= min_temperature &&
                            node_settings.setpoint <= max_temperature
                        )
                        {
                            let rel_pos;
                            if (node_settings.valve_mode === "HEATING")
                            {
                                // For HEATING, min_temperature_position is closed, max_temperature_position is open
                                rel_pos = min_temperature_position + ((node_settings.setpoint - min_temperature) / temp_range) * pos_range;
                            }
                            else
                            {
                                // For COOLING, max_temperature_position is closed, min_temperature_position is open
                                rel_pos = max_temperature_position + ((node_settings.setpoint - max_temperature) / -temp_range) * pos_range;
                            }
                            force_position = Math.min(Math.max(rel_pos, 0), 100);
                            helper.log(node, "Set force position to " + force_position.toFixed(1) + "% based on previous min/max temperature positions");
                        }
                    }

                    startSampling();
                    break;

                case "off":
                case "disable":
                    if (!node_settings.enabled)
                        break;

                    node_settings.enabled = false;

                    stopSampling();
                    doOffMode();
                    break;

                case "setpoint":
                    let new_setpoint = parseFloat(msg.payload);
                    if (isNaN(new_setpoint) || !isFinite(new_setpoint))
                    {
                        // helper.warn(this, "Invalid payload: " + msg.payload);
                        return;
                    }

                    node_settings.setpoint = new_setpoint;
                    break;

                case "off_mode":
                    switch (msg.payload)
                    {
                        case "NOTHING":
                        case "OPEN":
                        case "CLOSE":
                            node_settings.off_mode = msg.payload;

                            if (!node_settings.enabled)
                                doOffMode();
                            break;

                        default:
                            helper.warn(this, "Invalid off_mode: " + msg.payload);
                            return;
                    }
                    break;

                case "valve_mode":
                    switch (msg.payload)
                    {
                        case "HEATING":
                        case "COOLING":

                            if (node_settings.valve_mode != msg.payload)
                            {
                                // When changing the mode, reset min/max temperature
                                min_temperature = null;
                                max_temperature = null;
                                min_temperature_position = null;
                                max_temperature_position = null;
                            }

                            node_settings.valve_mode = msg.payload;
                            setStatus();
                            break;

                        default:
                            helper.warn(this, "Invalid valve_mode: " + msg.payload);
                            return;
                    }

                    startSampling();
                    break;

                case "current_temperature":
                    let new_temp = parseFloat(msg.payload);
                    if (isNaN(new_temp) || !isFinite(new_temp))
                    {
                        // helper.warn(this, "Invalid payload for current_temperature: " + msg.payload);
                        return;
                    }
                    current_temperature = new_temp;
                    break;

                case "calibrate":
                    calibrate();
                    break;

                default:
                    helper.warn(this, "Invalid topic: " + real_topic);
                    return;
            }

            notifyCentral(node_settings.enabled);
        }

        let startSampling = () =>
        {
            if (!node_settings.enabled)
            {
                helper.log(node, "Node is disabled, cannot start sampling");
                return;
            }

            // Wait for calibration first
            if (node_settings.last_position === null || calibration_timeout !== null)
            {
                helper.log(node, "Cannot start sampling yet");
                return;
            }

            // sampling is already running, so do nothing
            if (sampling_interval !== null)
            {
                helper.log(node, "Sampling already running");
                return;
            }

            // start sampling
            if (force_position !== null)
            {
                switch (output_mode)
                {
                    case OUTPUT_MODE_OPEN_CLOSE:

                        sampling_interval = -1; // mark as running

                        helper.log(node, "Force position to " + force_position.toFixed(1) + "%");

                        // Under precision % difference => do nothing
                        if (Math.abs(node_settings.last_position - force_position) <= node_settings.precision)
                        {
                            helper.log(node, "No Force position needed");
                            force_position = null;
                            return;
                        }

                        let adjustAction = ADJUST_CLOSE;
                        if (node_settings.last_position < force_position)
                            adjustAction = ADJUST_OPEN;

                        let time_ms = Math.abs(node_settings.last_position - force_position) * time_total_s * 1000 / 100;
                        helper.log(node, "Start force changing " + adjustAction + " for " + time_ms + " ms");
                        startChanging(adjustAction, time_ms);
                        return;

                    case OUTPUT_MODE_PERCENTAGE:
                        // Output mode percentage
                        node_settings.last_position = force_position;
                        node.send({ payload: node_settings.last_position });
                        smart_context.set(node.id, node_settings);
                        setStatus();
                }
            }

            sampling_interval = setInterval(sample, time_sampling_s * 1000);

            setStatus();
        }

        let stopSampling = () =>
        {
            // Wait for calibration first
            if (node_settings.last_position === null || calibration_timeout !== null)
                return;

            // sampling is not running, so do nothing
            if (sampling_interval === null)
                return;

            // stop sampling
            clearInterval(sampling_interval);
            sampling_interval = null;

            setStatus();
        }

        let sample = () =>
        {
            // No current temperature available or in calibration => no action
            if (current_temperature === null || calibration_timeout !== null || !node_settings.enabled)
            {
                helper.log(node, "No sample possible", {
                    current_temperature,
                    calibration_timeout,
                    enabled: node_settings.enabled
                });
                return;
            }

            // +/- 1°C => already good enough, do nothing
            let temp_diff = Math.abs(current_temperature - node_settings.setpoint);
            if (temp_diff < node_settings.precision)
            {
                // Found a good position for the current setpoint
                // Update min/max temperature
                if (min_temperature === null || current_temperature < min_temperature)
                {
                    min_temperature = current_temperature;
                    min_temperature_position = node_settings.last_position;
                }

                if (max_temperature === null || current_temperature > max_temperature)
                {
                    max_temperature = current_temperature;
                    max_temperature_position = node_settings.last_position;
                }
                return;
            }

            // 0 °C diff => 0% change
            // for max_change_temp_difference (default: 20 °C) diff => max_change_percent (default: 2%) change
            let change_percentage = helper.scale(
                Math.min(temp_diff, node_settings.max_change_temp_difference),
                0,
                node_settings.max_change_temp_difference,
                0,
                node_settings.max_change_percent
            );

            // calculate direction
            let adjustAction = ADJUST_CLOSE;
            if (current_temperature < node_settings.setpoint)
            {
                if (node_settings.valve_mode == "HEATING")
                    adjustAction = ADJUST_OPEN;
            }
            else
            {
                if (node_settings.valve_mode == "COOLING")
                    adjustAction = ADJUST_OPEN;
            }

            switch (output_mode)
            {
                case OUTPUT_MODE_PERCENTAGE:
                    if (adjustAction == ADJUST_CLOSE)
                        node_settings.last_position -= change_percentage;
                    else
                        node_settings.last_position += change_percentage;

                    // Only values from 0 to 100 are allowed
                    node_settings.last_position = Math.min(Math.max(node_settings.last_position, 0), 100);

                    node.send({ payload: node_settings.last_position });
                    smart_context.set(node.id, node_settings);
                    setStatus();
                    return;

                case OUTPUT_MODE_OPEN_CLOSE:
                    break;
            }

            // Calculate change time in ms
            // Change time in ms
            let moving_time = (time_total_s * 1000 / 100) * change_percentage;

            if (moving_time < node_settings.min_change_time)
                moving_time = node_settings.min_change_time;

            // start moving
            startChanging(adjustAction, moving_time);
        }

        let startChanging = (adjustAction, time_ms) =>
        {
            if (output_mode !== OUTPUT_MODE_OPEN_CLOSE)
            {
                helper.log(node, "startChanging is only supported in OPEN/CLOSE output mode");
                return;
            }

            // Already changing
            if (changing_timeout !== null)
                return;

            helper.log(node, "Start changing", adjustAction, time_ms)
            stopChanging();

            // Already oppened/closed
            if (adjustAction == ADJUST_OPEN && node_settings.last_position >= 100)
                time_ms = time_total_s * 1000 / 200; // Change at least 1/200 => 0.5 %
            else if (adjustAction == ADJUST_CLOSE && node_settings.last_position <= 0)
                time_ms = time_total_s * 1000 / 200; // Change at least 1/200 => 0.5 %

            adjusting_start_time = Date.now();
            if (adjustAction == ADJUST_OPEN)
                node.send([{ payload: true }, { payload: false }, null]);
            else
                node.send([{ payload: false }, { payload: true }, null]);

            adjusting = adjustAction;
            changing_timeout = setTimeout(() =>
            {
                changing_timeout = null;
                stopChanging();
                adjusting = null;
                setStatus();
                notifyCentral(node_settings.enabled);
            }, time_ms);

            setStatus();
        }

        let stopChanging = () =>
        {
            // Stop any runnting timeout
            if (changing_timeout !== null)
            {
                if (force_position !== null)
                {
                    force_position = null;
                    sampling_interval = null;
                    startSampling();
                }

                clearTimeout(changing_timeout);
                changing_timeout = null;
            }

            // No changing in progress
            if (adjusting_start_time == null)
                return;

            // Calculate moved percentage
            let time_passed = (Date.now() - adjusting_start_time) / 1000;
            adjusting_start_time = null;

            let changed_value = (time_passed / time_total_s) * 100; // calculate in % value (0-100)
            if (adjusting == ADJUST_OPEN)
                node_settings.last_position += changed_value;
            else
                node_settings.last_position -= changed_value;

            // Only values from 0 to 100 are allowed
            node_settings.last_position = Math.min(Math.max(node_settings.last_position, 0), 100);
            smart_context.set(node.id, node_settings);

            node.send([{ payload: false }, { payload: false }, { payload: node_settings.last_position }]);

            setStatus();
        }

        let calibrate = () =>
        {
            if (output_mode !== OUTPUT_MODE_OPEN_CLOSE)
            {
                node.warn("Calibration is only supported in OPEN/CLOSE output mode");
                return;
            }

            // start closing
            node.send([{ payload: false }, { payload: true }, null]);

            calibration_timeout = setTimeout(() =>
            {
                // stop closing
                node.send([{ payload: false }, { payload: false }, null]);
                node_settings.last_position = 0;
                smart_context.set(node.id, node_settings);

                // Calibration finished, start sampling if enabled
                calibration_timeout = null;

                if (node_settings.enabled)
                    startSampling();
                else
                    stopSampling();

                setStatus();
                notifyCentral(node_settings.enabled);
            }, time_total_s * 1000);
        }

        let doOffMode = () =>
        {
            switch (node_settings.off_mode)
            {
                case "OPEN":
                    switch (output_mode)
                    {
                        case OUTPUT_MODE_OPEN_CLOSE:
                            startChanging(ADJUST_OPEN, time_total_s * 1000);
                            break;

                        case OUTPUT_MODE_PERCENTAGE:
                            node_settings.last_position = 100;
                            node.send({ payload: node_settings.last_position });
                            smart_context.set(node.id, node_settings);
                            setStatus();
                            break;
                    }
                    break;

                case "CLOSE":
                    switch (output_mode)
                    {
                        case OUTPUT_MODE_OPEN_CLOSE:
                            startChanging(ADJUST_CLOSE, time_total_s * 1000);
                            break;

                        case OUTPUT_MODE_PERCENTAGE:
                            node_settings.last_position = 0;
                            node.send({ payload: node_settings.last_position });
                            smart_context.set(node.id, node_settings);
                            setStatus();
                            break;
                    }

                case "NOTHING":
                default:
                    break;
            }
        }

        let resetSavedTemperatures = () =>
        {
            let now = Date.now();

            // Reset saved temperatures after 7 days, to avoid using too old data
            if (now - temp_save_date >= 7 * 24 * 60 * 60 * 1000)
            {
                temp_save_date = now;
                min_temperature = null;
                min_temperature_position = null;
                max_temperature = null;
                max_temperature_position = null;
            }
        }

        let setStatus = () =>
        {
            if (calibration_timeout !== null)
                node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": In calibration" });
            else if (changing_timeout != null)
                node.status({ fill: node_settings.enabled ? "green" : "red", shape: "ring", text: helper.getCurrentTimeForStatus() + ": " + (node_settings.valve_mode == "HEATING" ? "🔥" : "❄️") + "  " + (adjusting == ADJUST_OPEN ? "Opening" : "Closing") + ", Set: " + helper.toFixed(node_settings.setpoint, 1) + "°C, Cur: " + helper.toFixed(current_temperature, 1) + "°C, Pos: " + helper.toFixed(node_settings.last_position, 1) + "%" });
            else
                node.status({ fill: node_settings.enabled ? "green" : "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": " + (node_settings.valve_mode == "HEATING" ? "🔥" : "❄️") + " Set: " + helper.toFixed(node_settings.setpoint, 1) + "°C, Cur: " + helper.toFixed(current_temperature, 1) + "°C, Pos: " + helper.toFixed(node_settings.last_position, 1) + "%" });
        }

        /**
         * Notify all connected central nodes
         * @param {boolean} state The state if the valve is enabled
         */
        let notifyCentral = state =>
        {
            // helper.log(node, "notifyCentral", config.links, node);
            if (!config.links)
                return;

            config.links.forEach(link =>
            {
                // helper.log(node, link, { source: node.id, state: state });
                RED.events.emit("node:" + link, { source: node.id, state: state });
            });
        }

        if (node_settings.last_position === null)
        {
            if (output_mode === OUTPUT_MODE_OPEN_CLOSE)
            {
                // Start calibration after 10s
                setTimeout(calibrate, 10 * 1000);
            }
            else
            {
                node_settings.last_position = 0;
            }
        }
        else if (node_settings.enabled)
        {
            startSampling();
            node.send([null, null, { payload: helper.toFixed(node_settings.last_position, 1) }]);
        }

        setStatus();
    }

    RED.nodes.registerType("smart_mixing-valve", MixingValveNode);
}