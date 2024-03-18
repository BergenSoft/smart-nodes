module.exports = function (RED)
{
    "use strict";

    function SchedulerNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        var node_settings = {
            enabled: config.enabled,
            lastMessage: null,
        };

        if (config.save_state)
        {
            // load old saved values
            node_settings = Object.assign(node_settings, smart_context.get(node.id));
        }
        else
        {
            // delete old saved values
            smart_context.del(node.id);
        }

        let timeout = null;
        let nextEvent = null;

        // prepare schedules
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


        node.on("input", function (msg)
        {
            switch (helper.getTopicName(msg.topic))
            {
                case "enable":
                    if (node_settings.enabled)
                        return;

                    node_settings.enabled = true;
                    if (config.save_state)
                        smart_context.set(node.id, node_settings);
                    break;

                case "disable":
                    if (!node_settings.enabled)
                        return;

                    node_settings.enabled = false;
                    if (config.save_state)
                        smart_context.set(node.id, node_settings);
                    break;

                case "set_state":
                    if (node_settings.enabled == !!msg.payload)
                        return;

                    node_settings.enabled = !!msg.payload;
                    if (config.save_state)
                        smart_context.set(node.id, node_settings);
                    break;

                default:
                    return;
            }

            if (node_settings.enabled)
                initTimeouts();
            else
                clearTimeouts();

            setStatus();
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

            nextEvent = config.schedules[minIndex].nextEvent;
            let waitTime = nextEvent.getTime() - (new Date()).getTime();
            timeout = setTimeout(raiseEvent, waitTime, minIndex);
        }

        let calcNextEvent = i =>
        {
            const schedule = config.schedules[i];

            // If no day is checked then we cannot it is never raised
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

            // console.log({
            //     i,
            //     findNextDay,
            //     nextEvent
            // });

            return nextEvent;
        }

        let raiseEvent = i =>
        {
            const schedule = config.schedules[i];

            if (!node_settings.enabled)
                return;

            timeout = null;
            node.send(schedule.message);
            node_settings.lastMessage = schedule.message;

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

        if (config.save_state && config.resend_on_start && node_settings.lastMessage != null)
        {
            setTimeout(() =>
            {
                node.send(node_settings.lastMessage);
            }, 10000);
        }
    }

    RED.nodes.registerType("smart_scheduler", SchedulerNode);
}