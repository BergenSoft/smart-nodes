module.exports = {
    evaluateNodeProperty(RED, value, type)
    {
        try
        {
            switch (type)
            {
                case "null":
                    return null;

                default:
                    return RED.util.evaluateNodeProperty(value, type);
            }
        }
        catch (error)
        {
            console.error(error);
            return null;
        }
    },
    getTopicName(topic)
    {
        if (typeof topic == "undefined" || topic == null || topic == "" || typeof topic != "string")
            return null;

        if (topic.indexOf("#") == -1)
            return topic;

        return topic.substring(0, topic.indexOf("#"));
    },
    getTopicNumber(topic)
    {
        if (typeof topic == "undefined" || topic == null || topic == "")
            return null;

        if (typeof topic == "string")
        {
            if (topic.indexOf("#") != -1)
                return parseInt(topic.substring(topic.indexOf("#") + 1), 10);
        }

        let result = parseInt(topic, 10);
        if (isNaN(result) || !isFinite(result))
            return null;

        return result;
    },
    getTimeInMs(value, unit)
    {
        value = parseInt(value, 10);
        if (isNaN(value) || value == 0)
            return 0;

        switch (unit)
        {
            case "ms":
                return value;

            case "s":
            case "sec":
                return value * 1000;

            case "min":
                return value * 60 * 1000;

            case "h":
                return value * 3600 * 1000;
        }
    },
    getTimeInS(value, unit)
    {
        value = parseInt(value, 10);
        if (isNaN(value) || value == 0)
            return 0;

        switch (unit)
        {
            case "ms":
                return value / 1000;

            case "s":
                return value;

            case "min":
                return value * 60;

            case "h":
                return value * 3600;
        }
    },
    getTimeInMsFromString(value)
    {
        // default in ms
        if (typeof value == "number")
            return value;

        if (typeof value != "string")
            return 0;

        // Split 123min into ["123", "min"]
        let values = value.match(/^([0-9]+)(ms|s|sec|m|min|h)?$/)

        // string doesn't match
        if (values == null)
            return 0;

        // default is ms
        if (values.length == 2)
            return this.getTimeInMs(values[1], "ms");

        // default is ms
        if (values.length == 3)
            return this.getTimeInMs(values[1], values[2]);

        // Something went wrong
        return 0;
    },
    formatMsToStatus(value, timeConcatWord = null)
    {
        let result = "";

        if (timeConcatWord)
        {
            let date = (new Date(Date.now() + value));
            result = " " + timeConcatWord + " " + date.getHours() + ":" + ("" + date.getMinutes()).padStart(2, "0") + ":" + ("" + date.getSeconds()).padStart(2, "0");
        }

        if (value == 0)
            return "0:00" + result;

        // value in sec
        value = parseInt(value / 1000, 10);
        result = (value % 60) + result;
        if (value % 60 < 10)
            result = "0" + result;

        // value in min
        value = parseInt(value / 60, 10);
        result = (value % 60) + ":" + result;
        if (value % 60 < 10)
            result = "0" + result;

        // value in hour
        value = parseInt(value / 60, 10);
        result = (value % 24) + ":" + result;
        if (value % 24 < 10)
            result = "0" + result;

        // value in days
        value = parseInt(value / 24, 10);
        if (value > 0)
            result = value + "." + result;

        return result;
    }
};
