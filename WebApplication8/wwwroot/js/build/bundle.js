(function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function svg_element(name) {
        return document.createElementNS('http://www.w3.org/2000/svg', name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function empty() {
        return text('');
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function attribute_to_object(attributes) {
        const result = {};
        for (const attribute of attributes) {
            result[attribute.name] = attribute.value;
        }
        return result;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    let SvelteElement;
    if (typeof HTMLElement === 'function') {
        SvelteElement = class extends HTMLElement {
            constructor() {
                super();
                this.attachShadow({ mode: 'open' });
            }
            connectedCallback() {
                // @ts-ignore todo: improve typings
                for (const key in this.$$.slotted) {
                    // @ts-ignore todo: improve typings
                    this.appendChild(this.$$.slotted[key]);
                }
            }
            attributeChangedCallback(attr, _oldValue, newValue) {
                this[attr] = newValue;
            }
            $destroy() {
                destroy_component(this, 1);
                this.$destroy = noop;
            }
            $on(type, callback) {
                // TODO should this delegate to addEventListener?
                const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
                callbacks.push(callback);
                return () => {
                    const index = callbacks.indexOf(callback);
                    if (index !== -1)
                        callbacks.splice(index, 1);
                };
            }
            $set($$props) {
                if (this.$$set && !is_empty($$props)) {
                    this.$$.skip_bound = true;
                    this.$$set($$props);
                    this.$$.skip_bound = false;
                }
            }
        };
    }

    /* wwwroot/js/App.svelte generated by Svelte v3.32.3 */

    function create_fragment(ctx) {
    	let main;
    	let h1;
    	let t0;
    	let t1;
    	let t2;

    	return {
    		c() {
    			main = element("main");
    			h1 = element("h1");
    			t0 = text("Hello ");
    			t1 = text(/*name*/ ctx[0]);
    			t2 = text("!");
    			this.c = noop;
    			attr(h1, "id", /*id*/ ctx[1]);
    		},
    		m(target, anchor) {
    			insert(target, main, anchor);
    			append(main, h1);
    			append(h1, t0);
    			append(h1, t1);
    			append(h1, t2);
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*name*/ 1) set_data(t1, /*name*/ ctx[0]);

    			if (dirty & /*id*/ 2) {
    				attr(h1, "id", /*id*/ ctx[1]);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(main);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let { name } = $$props;
    	let { id } = $$props;

    	$$self.$$set = $$props => {
    		if ("name" in $$props) $$invalidate(0, name = $$props.name);
    		if ("id" in $$props) $$invalidate(1, id = $$props.id);
    	};

    	return [name, id];
    }

    class App extends SvelteElement {
    	constructor(options) {
    		super();
    		this.shadowRoot.innerHTML = `<style>h1{font-size:5em}</style>`;

    		init(
    			this,
    			{
    				target: this.shadowRoot,
    				props: attribute_to_object(this.attributes)
    			},
    			instance,
    			create_fragment,
    			safe_not_equal,
    			{ name: 0, id: 1 }
    		);

    		if (options) {
    			if (options.target) {
    				insert(options.target, this, options.anchor);
    			}

    			if (options.props) {
    				this.$set(options.props);
    				flush();
    			}
    		}
    	}

    	static get observedAttributes() {
    		return ["name", "id"];
    	}

    	get name() {
    		return this.$$.ctx[0];
    	}

    	set name(name) {
    		this.$set({ name });
    		flush();
    	}

    	get id() {
    		return this.$$.ctx[1];
    	}

    	set id(id) {
    		this.$set({ id });
    		flush();
    	}
    }

    customElements.define("svelte-app", App);

    /* wwwroot/js/Clock.svelte generated by Svelte v3.32.3 */

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[4] = list[i];
    	return child_ctx;
    }

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[7] = list[i];
    	return child_ctx;
    }

    // (74:8) {#each [1, 2, 3, 4] as offset}
    function create_each_block_1(ctx) {
    	let line;

    	return {
    		c() {
    			line = svg_element("line");
    			attr(line, "class", "minor");
    			attr(line, "y1", "42");
    			attr(line, "y2", "45");
    			attr(line, "transform", "rotate(" + 6 * (/*minute*/ ctx[4] + /*offset*/ ctx[7]) + ")");
    		},
    		m(target, anchor) {
    			insert(target, line, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(line);
    		}
    	};
    }

    // (66:4) {#each [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as minute}
    function create_each_block(ctx) {
    	let line;
    	let each_1_anchor;
    	let each_value_1 = [1, 2, 3, 4];
    	let each_blocks = [];

    	for (let i = 0; i < 4; i += 1) {
    		each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
    	}

    	return {
    		c() {
    			line = svg_element("line");

    			for (let i = 0; i < 4; i += 1) {
    				each_blocks[i].c();
    			}

    			each_1_anchor = empty();
    			attr(line, "class", "major");
    			attr(line, "y1", "35");
    			attr(line, "y2", "45");
    			attr(line, "transform", "rotate(" + 30 * /*minute*/ ctx[4] + ")");
    		},
    		m(target, anchor) {
    			insert(target, line, anchor);

    			for (let i = 0; i < 4; i += 1) {
    				each_blocks[i].m(target, anchor);
    			}

    			insert(target, each_1_anchor, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(line);
    			destroy_each(each_blocks, detaching);
    			if (detaching) detach(each_1_anchor);
    		}
    	};
    }

    function create_fragment$1(ctx) {
    	let svg;
    	let circle;
    	let line0;
    	let line0_transform_value;
    	let line1;
    	let line1_transform_value;
    	let g;
    	let line2;
    	let line3;
    	let g_transform_value;
    	let each_value = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
    	let each_blocks = [];

    	for (let i = 0; i < 12; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	return {
    		c() {
    			svg = svg_element("svg");
    			circle = svg_element("circle");

    			for (let i = 0; i < 12; i += 1) {
    				each_blocks[i].c();
    			}

    			line0 = svg_element("line");
    			line1 = svg_element("line");
    			g = svg_element("g");
    			line2 = svg_element("line");
    			line3 = svg_element("line");
    			this.c = noop;
    			attr(circle, "class", "clock-face");
    			attr(circle, "r", "48");
    			attr(line0, "class", "hour");
    			attr(line0, "y1", "2");
    			attr(line0, "y2", "-20");
    			attr(line0, "transform", line0_transform_value = "rotate(" + (30 * /*hours*/ ctx[0] + /*minutes*/ ctx[1] / 2) + ")");
    			attr(line1, "class", "minute");
    			attr(line1, "y1", "4");
    			attr(line1, "y2", "-30");
    			attr(line1, "transform", line1_transform_value = "rotate(" + (6 * /*minutes*/ ctx[1] + /*seconds*/ ctx[2] / 10) + ")");
    			attr(line2, "class", "second");
    			attr(line2, "y1", "10");
    			attr(line2, "y2", "-38");
    			attr(line3, "class", "second-counterweight");
    			attr(line3, "y1", "10");
    			attr(line3, "y2", "2");
    			attr(g, "transform", g_transform_value = "rotate(" + 6 * /*seconds*/ ctx[2] + ")");
    			attr(svg, "viewBox", "-50 -50 100 100");
    		},
    		m(target, anchor) {
    			insert(target, svg, anchor);
    			append(svg, circle);

    			for (let i = 0; i < 12; i += 1) {
    				each_blocks[i].m(svg, null);
    			}

    			append(svg, line0);
    			append(svg, line1);
    			append(svg, g);
    			append(g, line2);
    			append(g, line3);
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*hours, minutes*/ 3 && line0_transform_value !== (line0_transform_value = "rotate(" + (30 * /*hours*/ ctx[0] + /*minutes*/ ctx[1] / 2) + ")")) {
    				attr(line0, "transform", line0_transform_value);
    			}

    			if (dirty & /*minutes, seconds*/ 6 && line1_transform_value !== (line1_transform_value = "rotate(" + (6 * /*minutes*/ ctx[1] + /*seconds*/ ctx[2] / 10) + ")")) {
    				attr(line1, "transform", line1_transform_value);
    			}

    			if (dirty & /*seconds*/ 4 && g_transform_value !== (g_transform_value = "rotate(" + 6 * /*seconds*/ ctx[2] + ")")) {
    				attr(g, "transform", g_transform_value);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(svg);
    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let hours;
    	let minutes;
    	let seconds;
    	let time = new Date();

    	onMount(() => {
    		const interval = setInterval(
    			() => {
    				$$invalidate(3, time = new Date());
    			},
    			1000
    		);

    		return () => {
    			clearInterval(interval);
    		};
    	});

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*time*/ 8) {
    			// these automatically update when `time`
    			// changes, because of the `$:` prefix
    			$$invalidate(0, hours = time.getHours());
    		}

    		if ($$self.$$.dirty & /*time*/ 8) {
    			$$invalidate(1, minutes = time.getMinutes());
    		}

    		if ($$self.$$.dirty & /*time*/ 8) {
    			$$invalidate(2, seconds = time.getSeconds());
    		}
    	};

    	return [hours, minutes, seconds, time];
    }

    class Clock extends SvelteElement {
    	constructor(options) {
    		super();
    		this.shadowRoot.innerHTML = `<style>svg{width:100%;height:100%}.clock-face{stroke:#333;fill:white}.minor{stroke:#999;stroke-width:0.5}.major{stroke:#333;stroke-width:1}.hour{stroke:#333}.minute{stroke:#666}.second,.second-counterweight{stroke:rgb(180,0,0)}.second-counterweight{stroke-width:3}</style>`;

    		init(
    			this,
    			{
    				target: this.shadowRoot,
    				props: attribute_to_object(this.attributes)
    			},
    			instance$1,
    			create_fragment$1,
    			safe_not_equal,
    			{}
    		);

    		if (options) {
    			if (options.target) {
    				insert(options.target, this, options.anchor);
    			}
    		}
    	}
    }

    customElements.define("svg-clock", Clock);

}());
