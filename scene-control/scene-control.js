module.exports = function (RED)
{
    "use strict";

    function SceneControlNode(config)
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
            last_values: [], // light is on or off for a scene
        }, smart_context.get(node.id));

        // dynamic config
        let max_time_on = helper.getTimeInMs(config.max_time_on, config.max_time_on_unit);

        // runtime values
        let max_time_on_timeout = null;
        let isPermanent = false;
        let current_timeout_ms = 0;

        // central handling
        var event = "node:" + config.id;
        var handler = function (msg)
        {
            node.receive(msg);
        }
        RED.events.on(event, handler);


        if (node_settings.last_values.length != config.scenes.length)
        {
            // Per default expect that all outputs are off
            node_settings.last_values = new Array(config.outputs).fill(false);
        }

        node.status({});

        node.on("input", function (msg)
        {
            handleTopic(msg);

            // At least one light is on, now
            if (getCurrentScene() != 0)
                startAutoOffIfNeeded(helper.getTimeInMsFromString(msg.time_on ?? max_time_on));

            status();
            smart_context.set(node.id, node_settings);
        });

        node.on("close", function ()
        {
            stopAutoOff();
            RED.events.off(event, handler);
        });

        let handleTopic = msg =>
        {
            let currentScene = getCurrentScene();
            let [real_topic, scenes] = helper.getTopicName(msg.topic).split("_");
            let number = helper.getTopicNumber(msg.topic) - 1; // number should be used 0-based

            switch (real_topic)
            {
                case "status":
                    // Make sure it is bool
                    msg.payload = !!msg.payload;
                    node_settings.last_values[number] = msg.payload;

                    notifyCentral();

                    // All off? Stop permanent
                    if (getCurrentScene() == 0)
                        isPermanent = false;

                    // never forward status message to next node
                    return;

                case "off":
                    node_settings.last_values = new Array(config.outputs).fill(false);
                    break;

                case "on":
                    node_settings.last_values = new Array(config.outputs).fill(true);
                    break;

                case "set":
                    // Make sure it is bool
                    msg.payload = !!msg.payload;
                    node_settings.last_values = new Array(config.outputs).fill(msg.payload);

                    // This happens because of splitting by _ for scenes
                    if (scenes == "permanent")
                        isPermanent = msg.payload;
                    break;

                case "scene":
                    // Skip if button is released;
                    if (msg.payload === false)
                        return;

                    if (typeof scenes === "undefined")
                    {
                        node.error("called topic=scene without scene(s) set. Try topic=scene_0,1");
                        return;
                    }

                    scenes = scenes.split(",").map(s => parseInt(s, 10));

                    if (scenes.length == 0)
                    {
                        node.error("called topic=scene without scene(s) set. Try topic=scene_0,1");
                        return;
                    }

                    let nextSceneIndex = scenes.indexOf(currentScene);
                    if (nextSceneIndex === -1 || nextSceneIndex == scenes.length - 1)
                        nextSceneIndex = scenes[0];
                    else
                        nextSceneIndex = scenes[nextSceneIndex + 1];

                    // To be able to toggle if only one scene is set
                    if (currentScene == nextSceneIndex)
                        nextSceneIndex = 0;

                    if (nextSceneIndex == 0)
                    {
                        node_settings.last_values = new Array(config.outputs).fill(false);
                    }
                    else
                    {
                        const scene = config.scenes[nextSceneIndex - 1]; // scene numbers are 1 based
                        const expectedOn = scene.outputs.split(",");
                        for (let o = 0; o < node_settings.last_values.length; o++)
                        {
                            const output = node_settings.last_values[o];
                            // Check if output has to be changed
                            if ((output && !expectedOn.includes("" + (o + 1))) || (!output && expectedOn.includes("" + (o + 1))))
                            {
                                node_settings.last_values[o] = !output;
                            }
                        }
                    }
                    break;

                case "toggle":
                    // Skip if button is released;
                    if (msg.payload === false)
                        return;

                    node_settings.last_values = new Array(config.outputs).fill(currentScene == 0);
                    break;
            }

            stopAutoOff();

            node.send(node_settings.last_values.map(val => { return { payload: val }; }));
            notifyCentral();
        }

        let getCurrentScene = () =>
        {
            // All off ist scene 0
            if (!node_settings.last_values.includes(true))
                return 0;

            for (let s = 0; s < config.scenes.length; s++)
            {
                const scene = config.scenes[s];
                const expectedOn = scene.outputs.split(",");
                let skipScene = false;

                for (let o = 0; o < node_settings.last_values.length; o++)
                {
                    const output = node_settings.last_values[o];
                    // Check if one condition fails
                    if ((output && !expectedOn.includes("" + (o + 1))) || (!output && expectedOn.includes("" + (o + 1))))
                    {
                        skipScene = true;
                        break;
                    }
                }

                if (skipScene)
                    continue;

                return s + 1; // Scene number is 1 based
            }

            // Not a scene
            return null;
        }

        let startAutoOffIfNeeded = origTimeMs =>
        {
            let timeMs = parseInt(origTimeMs, 10);

            if (isNaN(timeMs))
            {
                node.error("Invalid time_on value send: " + origTimeMs);
                timeMs = max_time_on;
            }

            current_timeout_ms = timeMs;

            // Stop if any timeout is set
            stopAutoOff();

            // 0 = Always on or already off
            if (timeMs <= 0 || isPermanent || getCurrentScene() == 0)
                return;

            max_time_on_timeout = setTimeout(() =>
            {
                node_settings.last_values = new Array(config.outputs).fill(false);
                node.send(node_settings.last_values.map(val => { return { payload: val }; }));
                notifyCentral();

                status();
                smart_context.set(node.id, node_settings);
            }, timeMs);
        }

        let stopAutoOff = () =>
        {
            if (max_time_on_timeout != null)
            {
                clearTimeout(max_time_on_timeout);
                max_time_on_timeout = null;
            }
        }

        let status = () =>
        {
            let scene = getCurrentScene();
            if (scene != 0)
            {
                if (isPermanent || current_timeout_ms <= 0)
                    node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Scene " + scene + " active" });
                else if (max_time_on_timeout)
                    node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": Scene " + scene + " active, wait " + helper.formatMsToStatus(current_timeout_ms, "until") + " for auto off" });
            }
            else
            {
                node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Off" });
            }
        }

        let notifyCentral = () =>
        {
            if (!config.links)
                return;

            let state = getCurrentScene() !== 0;

            config.links.forEach(link =>
            {
                // console.log(node.id + " -> " + link);
                // console.log({ source: node.id, state: state });
                RED.events.emit("node:" + link, { source: node.id, state: state });
            });
        }

        // After node red restart, start also the timeout
        if (getCurrentScene() != 0)
            startAutoOffIfNeeded(helper.getTimeInMsFromString(max_time_on));

        status();
    }
    RED.nodes.registerType("smart_scene-control", SceneControlNode);
};
