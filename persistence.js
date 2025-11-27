const { log } = require('console');

let instance = null;

module.exports = function (_RED)
{
    if (instance != null)
        return instance;

    let hasChanges = false;
    let inTestMode = _RED.settings.userDir == null;

    // used for local debugging
    if (inTestMode)
        console.log("####### Test Mode detected #######");

    const fs = require('fs');
    const pathLib = require('path');

    // Fallback, falls RED.settings.userDir in Tests nicht gesetzt ist
    const userDir = (_RED.settings && _RED.settings.userDir) ? _RED.settings.userDir : process.cwd();
    const filePath = pathLib.join(userDir, 'SmartNodesContext.json');

    // console.log(filePath);    

    let globalData = {};

    if (fs.existsSync(filePath))
    {
        try
        {
            let fileContent = fs.readFileSync(filePath, "utf8");
            globalData = Object.assign({}, JSON.parse(fileContent));

            if (inTestMode)
                console.log("Loaded:", globalData);
        }
        catch (error)
        {
            console.error("Couldn't read SmartNodesContext.json", error);
        }
    }

    // Autosave each 15 seconds if changes exists.
    let interval = setInterval(() =>
    {
        if (hasChanges)
            save();

    }, 15 * 1000);

    // Prevent the interval from keeping the process alive (important for Jest)
    if (interval && typeof interval.unref === "function")
        interval.unref();

    function save()
    {
        try
        {
            if (inTestMode)
                console.log("Save SmartNodeContext", globalData);

            fs.writeFile(filePath, JSON.stringify(globalData), err =>
            {
                if (err)
                    console.error(err);
            });
            hasChanges = false;
        }
        catch (error)
        {
            console.error("Couldn't write SmartNodesContext.json", error);
        }
    }

    function set(id, data)
    {
        hasChanges = true;
        globalData["id" + id] = data;

        if (inTestMode)
            save();
    }

    function get(id, config_change_date)
    {
        let data = globalData["id" + id];
        if (id == "7e5e332f362a43fb")
        {
            log({
                old_config_change_date: data.config_change_date,
                new_config_change_date: config_change_date
            });
        }

        if (data && data.config_change_date && data.config_change_date !== config_change_date)
        {
            console.log("id = " + id + " - config change date mismatch, ignoring stored data.");
            return null;
        }


        return data;
    }

    function del(id)
    {
        hasChanges = true;
        delete globalData["id" + id];
    }

    function close()
    {
        if (interval)
        {
            clearInterval(interval);
            interval = null;
        }
    }

    instance = { set, get, del, close };
    return instance;
};