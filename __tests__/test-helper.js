const helper = require("node-red-node-test-helper");

module.exports = {
    helper,

    init: function ()
    {
        // init must be called once per test file before startServer
        helper.init(require.resolve("node-red"));

        beforeAll(() => this.startServer());
        afterAll(() => this.stopServer());
        afterEach(() => this.unload().then(() =>
        {
            process.removeAllListeners("uncaughtException");
            process.removeAllListeners("unhandledRejection");
        }));
    },

    startServer: function ()
    {
        return new Promise((resolve, reject) =>
        {
            helper.startServer((err) => (err ? reject(err) : resolve()));
        });
    },

    stopServer: function ()
    {
        return new Promise((resolve) =>
        {
            helper.stopServer(() => resolve());
        });
    },

    unload: function ()
    {
        return helper.unload().catch(() => { });
    }
};