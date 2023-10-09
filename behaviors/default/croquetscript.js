class ScriptRunnerActor {
    setup() {
    }

    start(tree) {
        this.root = tree;
        this.myTime = 0;
        this.startTime = this.now();
        this.currentTime = this.startTime;
        this.states = new Map(); // {term -> {step etc}}
        this.run(this.root, null);
        let wasRunning = this.running;
        this.running = true;
        this.toStop = false;
        if (!wasRunning) {
            this.runStep();
        }
    }

    run(tree, parentNode) {
        let type = tree.type;
        let state = this.states.get(tree);
        let firstTime = !state;
        if (firstTime) {
            state = {};
            state.parentNode = parentNode;
            this.states.set(tree, state);
            Object.keys(tree).forEach((k) => {
                state[k] = tree[k];
            });
        }

        if (firstTime) {
            if (type === "par") {
                state.done = 0;
                if (state.children.length === 0) {
                    return this.succeeded(tree, parentNode);
                }
                tree.children.forEach((child) => this.run(child, tree));
            } else if (type === "loop") {
                state.seqIndex = 0;
                if (state.count === undefined) {
                    state.count = 1;
                }
                state.loopCount = 0;
                if (state.children.length === 0) {
                    return this.succeeded(tree, parentNode);
                }
                this.run(tree.children[state.seqIndex], tree);
            } else if (type === "sel") {
                if (state.children.length === 0) {
                    return this.succeeded(tree, parentNode);
                }
                state.seqIndex = Math.floor(Math.random() * state.children.length);
                this.run(tree.children[state.seqIdex], tree);
            } else if (type === "call") {
                state.startTime = this.currentTime;
            } else if (type === "delay") {
                state.startTime = this.currentTime;
            } else if (type === "prim") {
                // state.startTime = this.currentTime;
            }
            return;
        }
    }

    runStep() {
        if (!this.running) {return;}
        this.currentTime = this.now();
        // console.log("this.currentTime", this.currentTime);

        this.states.forEach((value, key) => {
            this.step(key, value);
        });
        if (this.states.size !== 0 && this.running) {
            this.future(16).runStep();
        }
    }

    step(term, state) {
        if (state.type === "call") {
            let {object, action, startTime, duration} = state;
            let time = Math.min(duration, this.currentTime - startTime);
            state.time = time;
            let step;

            if (time === 0 && state.duration > 0) {
                step = "firstTime";
            } else if (time === state.duration) {
                step = "lastTime";
            } else {
                step = "eachTime";
            }

            state.step = step;
            let realObject = this.lookup(object);
            let val = realObject.call(...action, state);
            if (val !== null) {
                if (step === "lastTime") {
                    this.succeeded(term);
                }
                return;
            } else {
                this.failed(term);
            }
            // I think we need to carry over the fraction
            // (startTime + now - duration) to the next one's invocation
        } else if (state.type === "delay") {
            let {startTime, duration} = state;
            if (!term.children || term.children.length === 0) {
                this.succeeded(term);
                return;
            }
            if (this.currentTime - startTime >= duration) {
                this.run(term.children[0], term);
            }
        } else if (state.type === "prim") {
            let {object, action, params} = state;
            let realObject = this.lookup(object);
            realObject.call(...action, ...params);
            this.succeeded(term);
        }
    }

    failed(term) {
        let state = this.states.get(term);
        this.states.delete(term);
        if (!state.parentNode) {
            return false;
        }
        this.failedChild(state.parentNode);
    }

    failedChild(parentNode) {
        let parentNodeState = this.states.get(parentNode);
        if (parentNode.type === "sel") {
            parentNodeState.index++;
            if (parentNodeState.index >= parentNodeState.children.length) {
                return this.failed(parentNode);
            }
            this.run(parentNode.children[parentNodeState.index], parentNode);
        }

        if (parentNode.type === "par" || parentNode.type === "loop") {
            return this.failed(parentNode);
        }
    }

    succeeded(term) {
        let state = this.states.get(term);
        this.states.delete(term);
        if (!state.parentNode) {
            return true;
        }
        this.succeededChild(state.parentNode);
    }

    succeededChild(parentNode) {
        let parentNodeState = this.states.get(parentNode);
        if (parentNode.type === "sel") {
            return this.succeeded(parentNode);
        }

        if (parentNode.type === "par") {
            parentNodeState.done++;
            if (parentNodeState.done >= parentNodeState.children.length) {
                this.succeeded(parentNode);
                return;
            }
        }

        if (parentNode.type === "loop") {
            parentNodeState.seqIndex++;
            if (parentNodeState.seqIndex >= parentNodeState.children.length) {
                parentNodeState.loopCount++;
                if (parentNodeState.loopCount >= parentNodeState.count) {
                    return this.succeeded(parentNode);
                }
                parentNodeState.seqIndex = 0;
                if (parentNodeState.children.length === 0) {
                    return this.succeeded(parentNode);
                    // looks redundant but guards the case of dynamic editing
                }
            }
            this.run(parentNode.children[parentNodeState.seqIndex], parentNode);
            return;
        }

        if (parentNode.type === "delay") {
            this.succeeded(parentNode);
            return;
        }
    }

    lookup(id) {
        return this.service("ActorManager").actors.get(id);
    }

    teardown() {
        this.running = false;
    }
}

class ScriptActionsActor {
    translateTo(state) {
        if (state.step === "lastTime") {
            this.translation = state.params;
            return this;
        }

        if (state.step === "firstTime") {
            state.startTranslation = this.translation;
            return this;
        }

        let t = Math.min(1, state.time / state.duration);

        this.translation = Microverse.v3_lerp(state.startTranslation, state.params, t);
        return this;
    }

    translateBy(state) {
        if (state.step === "lastTime") {
            this.translation = Microverse.v3_add(state.startTranslation || this.translation, state.params);
            return this;
        }

        if (state.step === "firstTime") {
            state.startTranslation = this.translation;
            return this;
        }
        let t = Math.min(1, state.time / state.duration);

        this.translation = Microverse.v3_lerp(state.startTranslation, Microverse.v3_add(state.startTranslation, state.params), t);
        // console.log(this.id, this.translation);
        return this;
    }

    turnBy(state) {
        let {q_euler, q_multiply, q_slerp} = Microverse;
        let q = state.params.length === 4 ? state.params : q_euler(...state.params);
        if (state.step === "lastTime") {
            this.rotation = q_multiply(state.startRotation || this.rotation, q);
            return this;
        }

        if (state.step === "firstTime") {
            state.startRotation = this.rotation;
            return this;
        }
        let t = Math.min(1, state.time / state.duration);

        this.rotation = q_slerp(
            state.startRotation,
            q_multiply(state.startRotation, q),
            t);
        // console.log(this.id, this.rotation);
        return this;
    }
}

class CubeMakerActor {
    setup() {
        if (this.objects) {
            this.objcts.forEach((o) => o.destroy());
        }
        this.objects = [];

        let tr = this.translation;

        for (let i = 0; i < 10; i++) {
            let object = this.createCard({
                type: "object",
                translation: Microverse.v3_add(tr, [i, 0, 0]),
                behaviorModules: ["ScriptCube"]
            });
            this.objects.push(object);
        }

        let children = this.objects.map((o, i) => ({
            type: "call",
            object: o.id,
            action: ["ScriptActions$ScriptActionsActor", "translateBy"],
            params: [0, i, 0],
            duration: 1000
        }));

        children.push({type: "delay", duration: 1000, children: []});

        this.tree = {type: "loop", children, count: 3};

        if (this.runner) {
            this.runner.destroy();
        }
        this.runner = this.createCard({
            type: "object",
            parent: this,
            behaviorModules: ["ScriptRunner"]
        });
        this.runner.call("ScriptRunner$ScriptRunnerActor", "start", this.tree);
    }
}

class CubeActor {
    setup() {
        this._cardData.color = this.randomColor();
    }

    randomColor() {
        let h = Math.random();
        let s = 0.8;
        let v = 0.8;
        let r, g, b, i, f, p, q, t;
        i = Math.floor(h * 6);
        f = h * 6 - i;
        p = v * (1 - s);
        q = v * (1 - f * s);
        t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: r = v, g = t, b = p; break;
            case 1: r = q, g = v, b = p; break;
            case 2: r = p, g = v, b = t; break;
            case 3: r = p, g = q, b = v; break;
            case 4: r = t, g = p, b = v; break;
            case 5: r = v, g = p, b = q; break;
        }
        return ((Math.round(r * 255) << 16) +
                (Math.round(g * 255) << 8) +
                Math.round(b * 255))
    }
}

class CubePawn {
    setup() {
        [...this.shape.children].forEach((c) => {
            c.removeFromParent();
        });
        let cube = this.makeCube();
        this.shape.add(cube);
    }

    makeCube() {
        let geometry = new Microverse.THREE.BoxGeometry(1, 1, 1);
        let material = new Microverse.THREE.MeshStandardMaterial({color: this.actor._cardData.color, metalness: 0.8});
        return new Microverse.THREE.Mesh(geometry, material);
    }
}

export default {
    modules: [
        {
            name: "ScriptRunner",
            actorBehaviors: [ScriptRunnerActor]
        },
        {
            name: "ScriptActions",
            actorBehaviors: [ScriptActionsActor]
        },
        {
            name: "ScriptCube",
            actorBehaviors: [CubeActor],
            pawnBehaviors: [CubePawn]
        },
        {
            name: "CubeMaker",
            actorBehaviors: [CubeMakerActor]
        },
    ]
};

/* globals Microverse */
