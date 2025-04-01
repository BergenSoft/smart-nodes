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
            last_position: null
        }, smart_context.get(node.id));


        // ##################
        // # Dynamic config #
        // ##################
        let time_total_s = config.time_total;
        let time_sampling_s = config.time_sampling;


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
            stopSampling();

            if (sampling_interval !== null)
            {
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
            let real_topic = helper.getTopicName(msg.topic);

            if (real_topic == "set_state")
                real_topic = (!!msg.payload) ? "enable" : "disable";

            switch (real_topic)
            {
                case "enable":
                    node_settings.enabled = true;

                    stopChanging();
                    startSampling();
                    break;

                case "disable":
                    node_settings.enabled = false;

                    stopSampling();
                    doOffMode();
                    break;

                case "setpoint":
                    let new_setpoint = parseFloat(msg.payload);
                    if (isNaN(new_setpoint) && !isFinite(new_setpoint))
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
                    if (isNaN(new_temp) && !isFinite(new_temp))
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
        }

        let startSampling = () =>
        {
            // Wait for calibration first
            if (node_settings.last_position === null || calibration_timeout !== null || !node_settings.enabled)
                return;

            // sampling is already running, so do nothing
            if (sampling_interval !== null)
                return;

            // start sampling
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
                helper.log("No sample possible", {
                    current_temperature,
                    calibration_timeout,
                    enabled: node_settings.enabled
                });
                return;
            }

            // +/- 1°C => already good enough, do nothing
            let temp_diff = Math.abs(current_temperature - node_settings.setpoint);
            if (temp_diff < 1)
                return;

            // Calculate change time
            // Change time in ms for 1%
            let moving_time = time_total_s * 1000 / 100;
            // 0 °C diff => 0% change
            // 20 °C diff => 2% change
            moving_time *= helper.scale(Math.min(temp_diff, 20), 0, 20, 0, 2);

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

            // start moving
            startChanging(adjustAction, moving_time);
        }

        let startChanging = (adjustAction, time_ms) =>
        {
            helper.log("Start changing", adjustAction, time_ms)
            stopChanging();

            // Already oppened/closed
            if (adjustAction == ADJUST_OPEN && node_settings.last_position == 100)
                time_ms = time_total_s * 1000 / 200; // Change at least 1/200 => 0.5 %
            else if (adjustAction == ADJUST_CLOSE && node_settings.last_position == 0)
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
            }, time_ms);

            setStatus();
        }

        let stopChanging = () =>
        {
            // Stop any runnting timeout
            if (changing_timeout !== null)
            {
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

            node.send([{ payload: false }, { payload: false }, { payload: helper.toFixed(node_settings.last_position, 1) }]);

            setStatus();
        }

        let calibrate = () =>
        {
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
            }, time_total_s * 1000);
        }

        let doOffMode = () =>
        {
            switch (node_settings.off_mode)
            {
                case "OPEN":
                    startChanging(ADJUST_OPEN, time_total_s * 1000);
                    break;

                case "CLOSE":
                    startChanging(ADJUST_CLOSE, time_total_s * 1000);
                    break;

                case "NOTHING":
                default:
                    break;
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

        if (node_settings.last_position == null)
        {
            // Start calibration after 10s
            setTimeout(calibrate, 10 * 1000);
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
