module.exports = function (RED)
{
    "use strict";

    function MixingValveNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        // persistent values
        var node_settings = Object.assign({}, {
            enabled: config.enabled,
            setpoint: config.setpoint,
            off_mode: config.off_mode,
            valve_mode: config.valve_mode,
            last_position: null
        }, smart_context.get(node.id));

        // dynamic config
        let time_total = config.time_total;
        let time_sampling = config.time_sampling;

        // runtime values
        let sampling_interval = null;
        let calibration_timeout = null;
        let changing_timeout = null;
        let changing_open = null;
        let current_temperature = null;
        let changing_start_time = null;

        node.on("input", function (msg)
        {
            handleTopic(msg);
        });

        node.on("close", function ()
        {
            stopSampling();

            if (sampling_interval !== null)
                clearInterval(sampling_interval);

            if (calibration_timeout !== null)
                clearTimeout(calibration_timeout);

            if (changing_timeout !== null)
                clearTimeout(changing_timeout);

            stopChanging();
        });


        let handleTopic = msg =>
        {
            let real_topic = helper.getTopicName(msg.topic);
            switch (real_topic)
            {
                case "enable":
                    node_settings.enabled = true;
                    smart_context.set(node.id, node_settings);

                    stopChanging();
                    startSampling();
                    break;

                case "disable":
                    node_settings.enabled = false;
                    smart_context.set(node.id, node_settings);

                    stopSampling();
                    doOffMode();
                    break;

                case "set_state":
                    node_settings.enabled = !!msg.payload; // force boolean
                    smart_context.set(node.id, node_settings);

                    if (node_settings.enabled)
                    {
                        startSampling();
                    }
                    else
                    {
                        stopSampling();
                        doOffMode();
                    }
                    break;

                case "setpoint":
                    let new_setpoint = parseFloat(msg.payload);
                    if (isNaN(new_setpoint) && !isFinite(new_setpoint))
                    {
                        // node.error("Invalid payload: " + msg.payload);
                        return;
                    }
                    node_settings.setpoint = new_setpoint;
                    smart_context.set(node.id, node_settings);
                    node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": New setpoint " + new_setpoint });
                    break;

                case "off_mode":
                    switch (msg.payload)
                    {
                        case "NOTHING":
                        case "OPEN":
                        case "CLOSE":
                            node_settings.off_mode = msg.payload;
                            smart_context.set(node.id, node_settings);

                            if (!node_settings.enabled)
                                doOffMode();
                            break;
                    }
                    break;

                case "valve_mode":
                    switch (msg.payload)
                    {
                        case "HEATING":
                        case "COOLING":
                            node_settings.valve_mode = msg.payload;
                            smart_context.set(node.id, node_settings);
                            setStatus();
                            break;
                    }
                    node_settings.enabled = true;
                    smart_context.set(node.id, node_settings);

                    startSampling();
                    break;

                case "current_temperature":
                    let new_temp = parseFloat(msg.payload);
                    if (isNaN(new_temp) && !isFinite(new_temp))
                    {
                        // node.error("Invalid payload: " + msg.payload);
                        return;
                    }
                    current_temperature = new_temp;
                    setStatus();
                    break;

                case "calibrate":
                    calibrate();
                    break;

                default:
                    node.error("Invalid topic: " + real_topic);
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
            sampling_interval = setInterval(sample, time_sampling * 1000);

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
                return;

            // +/- 1°C => already good enough, do nothing
            let temp_diff = Math.abs(current_temperature - node_settings.setpoint);
            if (temp_diff < 1)
                return;

            // Calculate change time
            // Change time in ms for 1%
            let moving_time = time_total * 1000 / 100;
            if (temp_diff > 5)
            {
                // 0 °C diff => 0% change
                // 20 °C diff => 5% change
                moving_time *= helper.scale(Math.min(temp_diff, 20), 0, 20, 0, 5);
            }

            // calculate direction
            let do_open = false;
            if (current_temperature < node_settings.setpoint)
            {
                if (node_settings.valve_mode == "HEATING")
                    do_open = true;
            }
            else
            {
                if (node_settings.valve_mode == "COOLING")
                    do_open = true;
            }

            // start moving
            startChanging(do_open, moving_time);

            setStatus();
        }

        let startChanging = (do_open, time_ms) =>
        {
            stopChanging();

            // Already oppened/closed
            if (do_open && node_settings.last_position == 100)
                return;
            if (!do_open && node_settings.last_position == 0)
                return;

            changing_start_time = Date.now();
            if (do_open)
                node.send([{ payload: true }, { payload: false }, null]);
            else
                node.send([{ payload: false }, { payload: true }, null]);

            node.status({
                fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": Start " + (do_open ? "opening" : "closing") + " for " + helper.formatMsToStatus(time_ms)
            });

            changing_open = do_open;
            changing_timeout = setTimeout(() =>
            {
                changing_timeout = null;
                stopChanging();
            }, time_ms);

        }

        let stopChanging = () =>
        {
            if (changing_timeout !== null)
            {
                clearTimeout(changing_timeout);
                changing_timeout = null;
            }

            // No changing in progress
            if (changing_start_time == null)
                return;

            // Calculate moved percentage
            let time_passed = (Date.now() - changing_start_time) / 1000;
            changing_start_time = null;

            let changed_value = (time_passed / time_total) * 100; // calculate in % value (0-100)
            if (changing_open)
                node_settings.last_position += changed_value;
            else
                node_settings.last_position -= changed_value;

            // Only values from 0 to 100 are allowed
            node_settings.last_position = Math.min(Math.max(node_settings.last_position, 0), 100);

            // Save state
            smart_context.set(node.id, node_settings);

            node.send([{ payload: false }, { payload: false }, { payload: node_settings.last_position.toFixed(1) }]);

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
            }, time_total * 1000);

            setStatus();
        }

        let doOffMode = () =>
        {
            switch (node_settings.off_mode)
            {
                case "OPEN":
                    startChanging(true, time_total * 1000);
                    break;

                case "CLOSE":
                    startChanging(false, time_total * 1000);
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
            else
                node.status({ fill: node_settings.enabled ? "green" : "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": " + (node_settings.valve_mode == "HEATING" ? "🔥" : "❄️") + " Set: " + node_settings.setpoint?.toFixed(1) + "°C, Cur: " + current_temperature?.toFixed(1) + "°C, Pos: " + node_settings.last_position?.toFixed(1) + "%" });
        }

        if (node_settings.last_position == null)
        {
            // Start calibration after 10s
            setTimeout(calibrate, 10 * 1000);
        }
        else if (node_settings.enabled)
        {
            startSampling();
            node.send([null, null, { payload: node_settings.last_position.toFixed(1) }]);
        }

        setStatus();
    }

    RED.nodes.registerType("smart_mixing-valve", MixingValveNode);
}
