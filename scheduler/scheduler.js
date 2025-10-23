module.exports = function (RED)
{
    "use strict";

    function SchedulerNode(config)
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
            enabled: config.enabled,
            last_message: null,
        };


        // load or delete saved values
        if (config.save_state)
            node_settings = Object.assign(node_settings, smart_context.get(node.id));
        else
            smart_context.del(node.id);


        // ##################
        // # Dynamic config #
        // ##################


        // ##################
        // # Runtime values #
        // ##################

        // Here the setTimeout return value is stored when the next timeout should happen
        let timeout = null;

        // This is date when the next event schould be raised
        let nextEvent = null;


        // Initially prepare schedules config object
        setTimeout(() =>
        {
            for (let i = 0; i < config.schedules.length; i++)
            {
                const schedule = config.schedules[i];
                schedule.position = i + 1;
                schedule.message = helper.evaluateNodeProperty(RED, schedule.message, "json");
                schedule.days = schedule.days.split(",");
            }

            if (node_settings.enabled)
                initNextTimeout();

            setStatus();
        }, 1000);


        // ###############
        // # Node events #
        // ###############
        node.on("input", function (msg)
        {
            handleTopic(msg);

            setStatus();

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
                    });
                    break;

                case "enable":
                    node_settings.enabled = true;
                    initNextTimeout();
                    break;

                case "disable":
                    node_settings.enabled = false;
                    break;
            }
        }

        // calculate which event should occur nect
        let initNextTimeout = () =>
        {
            let minIndex = null;
            for (let i = 0; i < config.schedules.length; i++)
            {
                config.schedules[i].nextEvent = calcNextEvent(i);
                if (config.schedules[i].nextEvent != null)
                {
                    if (minIndex == null || config.schedules[i].nextEvent < config.schedules[minIndex].nextEvent)
                        minIndex = i;
                }
            }

            // No events defined
            if (minIndex == null)
            {
                nextEvent = null;
                return;
            }

            // Stop timeout if any
            if (timeout != null)
            {
                clearTimeout(timeout);
                timeout = null;
            }

            nextEvent = config.schedules[minIndex].nextEvent;
            let waitTime = nextEvent.getTime() - (new Date()).getTime();
            timeout = setTimeout(() =>
            {
                timeout = null;
                raiseEvent(minIndex);
            }, waitTime);
        }

        // calculates the next time when the scheduled i-th entry should run.
        let calcNextEvent = i =>
        {
            const schedule = config.schedules[i];

            // If no day is checked it is never raised
            if (!schedule.days || schedule.days.length == 0)
                return null;

            let now = new Date();
            let findNextDay = false;

            // check if the time has already passed today
            if (now.getHours() > schedule.hour)
            {
                findNextDay = true;
            }
            else if (now.getHours() == schedule.hour)
            {
                if (now.getMinutes() > schedule.minute)
                {
                    findNextDay = true;
                }
                else if (now.getMinutes() == schedule.minute)
                {
                    findNextDay = now.getSeconds() >= schedule.second;
                }
            }

            // find next day when the event should be raised
            let possibleDay = schedule.days.filter(d => findNextDay ? d > now.getDay() : d >= now.getDay());
            if (possibleDay.length == 0)
                possibleDay = Math.min(...schedule.days);
            else
                possibleDay = Math.min(...possibleDay);

            let nextEvent = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() + (
                    findNextDay ?
                        possibleDay <= now.getDay() ? 7 - now.getDay() + possibleDay : possibleDay - now.getDay()
                        :
                        possibleDay < now.getDay() ? 7 - now.getDay() + possibleDay : possibleDay - now.getDay()
                ),
                schedule.hour,
                schedule.minute,
                schedule.second
            );

            // helper.log(node, {
            //     i,
            //     findNextDay,
            //     nextEvent
            // });

            return nextEvent;
        }

        // Send the i-th entry to the output
        let raiseEvent = i =>
        {
            const schedule = config.schedules[i];

            if (!node_settings.enabled)
                return;

            timeout = null;
            node.send(helper.cloneObject(schedule.message));
            node_settings.last_message = schedule.message;

            if (config.save_state)
                smart_context.set(node.id, node_settings);

            initNextTimeout();
            setStatus();
        }

        let setStatus = () =>
        {
            if (!node_settings.enabled)
            {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: helper.getCurrentTimeForStatus() + ": Scheduler disabled"
                });
            }
            else if (nextEvent == null)
            {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: helper.getCurrentTimeForStatus() + ": No events planned"
                });
            }
            else
            {
                // filter out empty values
                let time = nextEvent.getTime() - (new Date()).getTime();
                time = Math.ceil(time / 1000) * 1000;

                node.status({
                    fill: "yellow",
                    shape: "dot",
                    text: helper.getCurrentTimeForStatus() + ": Wait " + helper.formatMsToStatus(time, "until") + " to raise next event"
                });
            }
        }

        if (config.save_state && config.resend_on_start && node_settings.last_message != null)
        {
            setTimeout(() =>
            {
                node.send(helper.cloneObject(node_settings.last_message));
            }, 10000);
        }
    }

    RED.nodes.registerType("smart_scheduler", SchedulerNode);
}