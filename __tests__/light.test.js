const th = require("./test-helper");
const helper = th.helper;
const nodeModule = require("../light/light.js");

const nodeType = "smart_light-control";

th.init();

test("light node", (done) =>
{
    const flow = [
        { id: "n1", type: nodeType, name: "test-light", wires: [["n2"]] },
        { id: "n2", type: "helper" }
    ];

    helper.load(nodeModule, flow, () =>
    {
        try
        {
            const n1 = helper.getNode("n1");
            const n2 = helper.getNode("n2");

            if (!n1) return done(new Error("Node n1 wurde nicht erstellt"));
            if (!n2) return done(new Error("Helper-Node n2 fehlt"));

            n2.on("input", (msg) =>
            {
                try
                {
                    console.log("Received:", msg);
                    expect(msg).toBeDefined();
                }
                catch (err)
                {
                    done(err);
                }
            });

            n1.receive({ topic: "toggle" });
            n1.receive({ topic: "toggle" });

            setImmediate(() => { done(); });
        }
        catch (err)
        {
            done(err);
        }
    });
});