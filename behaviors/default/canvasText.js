//
// The actor still places strings into a 2D plane.
// the actor knows the strings used. upon getting all metric from the elected pawn.
// the actor layout blocks, and notifies the pawn to create THREE objects.

// each THREE js object should remember the properties from which it was created, and id
// the layout can go all blocks.
// use(str): if str is new, create an entry with null;
//           if str is there not do anything;
// unuse(str): really not do anything.

// requestMeasurement: indicates the elected view to compute the width for all strings that does not have proper width and height

// layout: once all width and height are there, iterate over strings entries to find ones that does not have x and y and find places for the string.


// a client is elected. => the client measures all text in actor._cardData.strings
// when measurement is done, the view sents load.
// all actors receives load. put strings in texture.
// based on that, layout blocks
// then ask view to create/update visual

// when the elected view changes => 

class TextTextureActor {
    setup() {
        if (!this._cardData.strings) {
            this._cardData.strings = new Map();
            this._cardData.texturePos = {x: 0, y: 0, maxHeight: 0};
        }
        this._cardData.canvasSize = 1024;
        this.listen("loadStart", "loadStart");
        this.listen("loadOne", "loadOne");
        this.listen("loadDone", "loadDone");

        this.test();
        this._cardData.layoutReady = false;
    }

    loadStart(key) {
        // last one wins
        this.key = key;
        this.loadCache = [];
    }

    loadOne(obj) {
        if (!this.key) {return;}
        if (obj.key !== this.key) {
            return;
        }
        this.loadCache.push(obj.buf);
    }

    loadDone(key) {
        if (!this.key) {return;}
        if (this.key !== key) {
            return;
        }

        let array = this.loadCache;
        delete this.loadCache;
        delete this.key;

        let len = array.reduce((acc, cur) => acc + cur.length, 0);
        let all = new Uint8Array(len);
        let ind = 0;
        for (let i = 0; i < array.length; i++) {
            all.set(array[i], ind);
            ind += array[i].length;
        }

        let result = new TextDecoder("utf-8").decode(all);
        this.loadAll(result);
    }

    loadAll(string) {
        let json = JSON.parse(string);
        console.log("TextTextureActor.loadAll: ", json);
        json.forEach((ary) => {
            this._cardData.strings.set(ary[0], ary[1]);
        });

        this.stringLayout(this._cardData.strings);
        if (this._cardData.layoutReady) {
            this.say("stringLayoutDone");
            this.say("render");
        }
    }

    measureText(str) {
        // this should always succeed.
        //console.log("TextTextureActor.measureText: ", str);
        return this._cardData.strings.get(str);
    }

    use(str) {
        let value = this._cardData.strings.get(str);
        if (!value) {
            this._cardData.strings.set(str, null);
            this._cardData.layoutReady = false;
            this.say("requestMeasurement");
        }
    }

    setTexturePos(t) {
        this._cardData.texturePos = t;
    }

    stringLayout(strings) {
        console.log("model layout 2");
        this._cardData.texturePos = {x: 0, y: 0, maxHeight: 0};
        
        let canvasSize = this._cardData.canvasSize;
        for (let [key, value] of strings) {
            if (!value) {
                this._cardData.layoutReady = false;
                return;
            }

            let metric = this.measureText(key);

            let {width, height, baseline} = metric;

            if (width > canvasSize) {
                console.log("too long");
                this._cardData.layoutReady = true;
                return;
            }

            if (this._cardData.texturePos.x + width >= canvasSize) {
                this.setTexturePos({x: 0, y: this._cardData.texturePos.y + this._cardData.texturePos.maxHeight, maxHeight: 0});
            }

            if (this._cardData.texturePos.y + height >= canvasSize) {
                let result = this.overflow(strings);
                let pos = this._cardData.texturePos;
                this.setTexturePos(result.texturePos);
                this.strings = result.strings;
                if (pos.texturePos.x + width >= canvasSize &&
                    pos.texturePos.y + height >= canvasSize) {
                    // even after packing, it still does not fit
                    console.log("really overflow");
                }
                this._cardData.layoutReady = true;
                return;
            }
            if (this._cardData.texturePos.x + width < canvasSize) {
                // the easy case
                let pos = this._cardData.texturePos;
                strings.set(key, {x: pos.x, y: pos.y, width, height, baseline, count: 1});
                this.setTexturePos({
                    x: pos.x + width, y: pos.y,
                    maxHeight: Math.max(pos.maxHeight, height)
                }); // baseline should be handled;
            }
        }
        this._cardData.layoutReady = true;
    }

    overflow(strings) {
        let old = [...strings];
        let texturePos = {x: 0, y: 0, maxHeight: 0};
        old = old.sort((a, b) => {
            return a.width - b.width;
        });

        while (old.length > 0) {
            let remain = this.canvas.width - texturePos.x;
            let nextIndex = this.fit(old, remain);
            if (nextIndex < 0) {
                // no string fits on the current line;
                let oldX = texturePos.x;
                texturePos = {x: 0, y: texturePos.y + texturePos.maxHeight, maxHeight: 0};
                if (oldX === 0) {
                    // it simply does not fit even as a lone element on a line
                    break;
                } else {
                    continue;
                }
            }
            let [tailKey, tailValue] = old[nextIndex];
            if (tailValue.width + texturePos.x > this.canvas.width) {
                continue;
            }
            old.splice(nextIndex, 1);
            let result = this.find(tailKey, texturePos, strings);
            strings = result.strings;
            texturePos = result.texturePos;
        }
        return {strings, texturePos};
    }

    fit(old, remain) {
        for (let i = 0; i < old.length; i++) {
            if (old[i][1].width < remain) {
                return i;
            }
        }
        return -1;
    }

    test() {
        this.use("forwardBy");
        this.use("turnBy");
    }
}

class TextTexturePawn {
    setup() {
        console.log("TextTexturePawn");
        if (this.texture) {
            this.texture.dispose();
        }

        if (this.canvas) {
            this.canvas.remove();
        }

        // every client has a canvas and texture and context

        let canvas = document.createElement("canvas");
        this.canvas = canvas;

        canvas.width = this.actor._cardData.canvasSize;
        canvas.height = this.actor._cardData.canvasSize;
        document.body.appendChild(canvas);
        canvas.style.position = "absolute";
        canvas.style.left = "200px";
        canvas.style.zIndex = "100";
        canvas.style.zIndex = "100";
        canvas.style.scale = "0.25";
        canvas.style.transformOrigin = "0 0";

        this.ctx = this.canvas.getContext("2d");
        this.ctx.font = "bold 64px sans-serif";
        this.ctx.fillStyle = "white";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.texture = new Microverse.THREE.CanvasTexture(canvas);

        this.strings = new Map();

        this.listen("handleElected", "handleElected");
        this.listen("handleUnelected", "handleUnelected");
        this.listen("requestMeasurement", "measureStrings");

        this.say("electionStatusRequested");

        this.listen("render", "render");
        if (this.actor._cardData.layoutReady) {
            this.render();
        }
    }

    measureText(str) {
        // should be called only on the elected client
        let measure = this.actor._cardData.strings.get(str);
        if (measure) {return measure;}

        measure = this.ctx.measureText(str);
        let width = Math.ceil(measure.width + 2); // avoid extending pixels
        let height = Math.ceil(measure.fontBoundingBoxDescent + measure.fontBoundingBoxAscent + 2);

        return {width, height, baseline: measure.fontBoundingBoxAscent};
    }

    render() {
        console.log("TextTexturePawn.render");
        this.ctx.fillStyle = "white";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.fillStyle = "black";
        for (let [str, value] of this.actor._cardData.strings) {
            let info = this.strings.get(str);
            if (info){}
            this.ctx.fillText(str, value.x, value.y + value.baseline);
        }

        this.renderingDone = true;
        this.texture.needsUpdate = true;

        console.log(this.actor.id, "doneRendering");

        this.publish(this.actor.id, "doneRendering");
    }

    async send(sendBuffer) {
        this.renderingDone = false;
        let string = JSON.stringify(sendBuffer);
        let array = new TextEncoder().encode(string);
        let ind = 0;
        let key = Math.random();

        this.say("loadStart", key);
        let throttle = array.length > 80000;

        while (ind < array.length) {
            let buf = array.slice(ind, ind + 2880);
            this.say("loadOne", {key, buf});
            ind += 2880;
            if (throttle) {
                await new Promise((resolve) => {
                    setTimeout(resolve, 5);
                });
            }
        }
        this.say("loadDone", key);
    }

    measureStrings() {
        if (!this.call("Elected$ElectedPawn", "isElected")) {
            return;
        }

        let sendBuffer = [];

        for (let [k, v] of this.actor._cardData.strings) {
            if (v) {continue;}
            let metric = this.measureText(k);
            sendBuffer.push([k, metric]);
        }

        this.send(sendBuffer);
    }

    measureAll() {
        let sendBuffer = [];

        for (let [k, _v] of this.actor._cardData.strings) {
            let metric = this.measureText(k);
            sendBuffer.push([k, metric]);
        }

        this.send(sendBuffer);
    }

    handleElected(data) {
        if (data && data.to !== this.viewId) {return;}

        console.log("measurer elected");
        this.measureAll();
    }

    handleUnelected() {
        console.log("measurer unelected");
        if (this.canvas) {
            this.canvas.remove();
            this.canvas = null;
        }
        if (this.ctx) {
            delete this.ctx;
        }
    }
}

export default {
    modules: [
        {
            name: "TextTexture",
            actorBehaviors: [TextTextureActor],
            pawnBehaviors: [TextTexturePawn]
        },
    ]
}

/* globals Microverse */
