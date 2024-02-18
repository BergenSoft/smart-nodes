module.exports = function (RED)
{
    function SchedulerNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smartContext = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        var nodeSettings = {
            enabled: config.enabled,
            lastMessage: null,
        };

        if (config.save_state)
        {
            // load old saved values
            nodeSettings = Object.assign(nodeSettings, smartContext.get(node.id));
        }
        else
        {
            // delete old saved values
            smartContext.del(node.id);
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

            if (nodeSettings.enabled)
                initNextTimeout();

            setStatus();
        }, 1000);


        node.on("input", function (msg)
        {
            switch (helper.getTopicName(msg.topic))
            {
                case "enable":
                    if (nodeSettings.enabled)
                        return;

                    nodeSettings.enabled = true;
                    if (config.save_state)
                        smartContext.set(node.id, nodeSettings);
                    break;

                case "disable":
                    if (!nodeSettings.enabled)
                        return;

                    nodeSettings.enabled = false;
                    if (config.save_state)
                        smartContext.set(node.id, nodeSettings);
                    break;

                case "set_state":
                    if (nodeSettings.enabled == !!msg.payload)
                        return;

                    nodeSettings.enabled = !!msg.payload;
                    if (config.save_state)
                        smartContext.set(node.id, nodeSettings);
                    break;

                default:
                    return;
            }

            if (nodeSettings.enabled)
                initTimeouts();
            else
                clearTimeouts();

            setStatus();
            smartContext.set(node.id, nodeSettings);
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

            if (!nodeSettings.enabled)
                return;

            timeout = null;
            node.send(schedule.message);
            nodeSettings.lastMessage = schedule.message;

            if (config.save_state)
                smartContext.set(node.id, nodeSettings);

            initNextTimeout();
            setStatus();
        }

        let setStatus = () =>
        {
            if (!nodeSettings.enabled)
            {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: (new Date()).toLocaleString() + ": Scheduler disabled"
                });
            }
            else if (nextEvent == null)
            {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: (new Date()).toLocaleString() + ": No events planned"
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
                    text: (new Date()).toLocaleString() + ": Wait " + helper.formatMsToStatus(time, "until") + " to raise next event"
                });
            }
        }

        if (config.save_state && config.resend_on_start && nodeSettings.lastMessage != null)
        {
            setTimeout(() =>
            {
                node.send(nodeSettings.lastMessage);
            }, 10000);
        }
    }

    RED.nodes.registerType("smart_scheduler", SchedulerNode);
}