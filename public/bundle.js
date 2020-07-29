var app = (function () {
    'use strict';

    function noop() { }
    function assign(tar, src) {
        // @ts-ignore
        for (const k in src)
            tar[k] = src[k];
        return tar;
    }
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
    function create_slot(definition, ctx, $$scope, fn) {
        if (definition) {
            const slot_ctx = get_slot_context(definition, ctx, $$scope, fn);
            return definition[0](slot_ctx);
        }
    }
    function get_slot_context(definition, ctx, $$scope, fn) {
        return definition[1] && fn
            ? assign($$scope.ctx.slice(), definition[1](fn(ctx)))
            : $$scope.ctx;
    }
    function get_slot_changes(definition, $$scope, dirty, fn) {
        if (definition[2] && fn) {
            const lets = definition[2](fn(dirty));
            if ($$scope.dirty === undefined) {
                return lets;
            }
            if (typeof lets === 'object') {
                const merged = [];
                const len = Math.max($$scope.dirty.length, lets.length);
                for (let i = 0; i < len; i += 1) {
                    merged[i] = $$scope.dirty[i] | lets[i];
                }
                return merged;
            }
            return $$scope.dirty | lets;
        }
        return $$scope.dirty;
    }
    function update_slot(slot, slot_definition, ctx, $$scope, dirty, get_slot_changes_fn, get_slot_context_fn) {
        const slot_changes = get_slot_changes(slot_definition, $$scope, dirty, get_slot_changes_fn);
        if (slot_changes) {
            const slot_context = get_slot_context(slot_definition, ctx, $$scope, get_slot_context_fn);
            slot.p(slot_context, slot_changes);
        }
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
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
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

    let current_component;
    function set_current_component(component) {
        current_component = component;
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
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function create_component(block) {
        block && block.c();
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
        const prop_values = options.props || {};
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
            dirty
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if ($$.bound[i])
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
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    /* src/components/NavBar.html generated by Svelte v3.24.0 */

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[3] = list[i];
    	return child_ctx;
    }

    const get_title_slot_changes = dirty => ({});
    const get_title_slot_context = ctx => ({});

    // (8:8) {#if items.length > 0}
    function create_if_block(ctx) {
    	let each_1_anchor;
    	let each_value = /*items*/ ctx[0];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	return {
    		c() {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			each_1_anchor = empty();
    		},
    		m(target, anchor) {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(target, anchor);
    			}

    			insert(target, each_1_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*items*/ 1) {
    				each_value = /*items*/ ctx[0];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		d(detaching) {
    			destroy_each(each_blocks, detaching);
    			if (detaching) detach(each_1_anchor);
    		}
    	};
    }

    // (9:8) {#each items as item}
    function create_each_block(ctx) {
    	let a;
    	let t_value = /*item*/ ctx[3].value + "";
    	let t;
    	let a_href_value;
    	let a_title_value;

    	return {
    		c() {
    			a = element("a");
    			t = text(t_value);
    			attr(a, "href", a_href_value = /*item*/ ctx[3].href);
    			attr(a, "title", a_title_value = /*item*/ ctx[3].value);
    			attr(a, "class", "svelte-hirfl2");
    		},
    		m(target, anchor) {
    			insert(target, a, anchor);
    			append(a, t);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*items*/ 1 && t_value !== (t_value = /*item*/ ctx[3].value + "")) set_data(t, t_value);

    			if (dirty & /*items*/ 1 && a_href_value !== (a_href_value = /*item*/ ctx[3].href)) {
    				attr(a, "href", a_href_value);
    			}

    			if (dirty & /*items*/ 1 && a_title_value !== (a_title_value = /*item*/ ctx[3].value)) {
    				attr(a, "title", a_title_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(a);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let header;
    	let t;
    	let nav;
    	let current;
    	const title_slot_template = /*$$slots*/ ctx[2].title;
    	const title_slot = create_slot(title_slot_template, ctx, /*$$scope*/ ctx[1], get_title_slot_context);
    	let if_block = /*items*/ ctx[0].length > 0 && create_if_block(ctx);

    	return {
    		c() {
    			header = element("header");
    			if (title_slot) title_slot.c();
    			t = space();
    			nav = element("nav");
    			if (if_block) if_block.c();
    			attr(nav, "class", "svelte-hirfl2");
    			attr(header, "class", "svelte-hirfl2");
    		},
    		m(target, anchor) {
    			insert(target, header, anchor);

    			if (title_slot) {
    				title_slot.m(header, null);
    			}

    			append(header, t);
    			append(header, nav);
    			if (if_block) if_block.m(nav, null);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			if (title_slot) {
    				if (title_slot.p && dirty & /*$$scope*/ 2) {
    					update_slot(title_slot, title_slot_template, ctx, /*$$scope*/ ctx[1], dirty, get_title_slot_changes, get_title_slot_context);
    				}
    			}

    			if (/*items*/ ctx[0].length > 0) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					if_block.m(nav, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(title_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(title_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(header);
    			if (title_slot) title_slot.d(detaching);
    			if (if_block) if_block.d();
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let { items = [] } = $$props;
    	let { $$slots = {}, $$scope } = $$props;

    	$$self.$set = $$props => {
    		if ("items" in $$props) $$invalidate(0, items = $$props.items);
    		if ("$$scope" in $$props) $$invalidate(1, $$scope = $$props.$$scope);
    	};

    	return [items, $$scope, $$slots];
    }

    class NavBar extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, { items: 0 });
    	}
    }

    /* src/components/Container.html generated by Svelte v3.24.0 */

    const get_right_slot_changes = dirty => ({});
    const get_right_slot_context = ctx => ({});
    const get_left_slot_changes = dirty => ({});
    const get_left_slot_context = ctx => ({});

    function create_fragment$1(ctx) {
    	let section;
    	let div0;
    	let t;
    	let div1;
    	let current;
    	const left_slot_template = /*$$slots*/ ctx[1].left;
    	const left_slot = create_slot(left_slot_template, ctx, /*$$scope*/ ctx[0], get_left_slot_context);
    	const right_slot_template = /*$$slots*/ ctx[1].right;
    	const right_slot = create_slot(right_slot_template, ctx, /*$$scope*/ ctx[0], get_right_slot_context);

    	return {
    		c() {
    			section = element("section");
    			div0 = element("div");
    			if (left_slot) left_slot.c();
    			t = space();
    			div1 = element("div");
    			if (right_slot) right_slot.c();
    			attr(div0, "class", "left svelte-1do9i0f");
    			attr(div1, "class", "right svelte-1do9i0f");
    			attr(section, "class", "svelte-1do9i0f");
    		},
    		m(target, anchor) {
    			insert(target, section, anchor);
    			append(section, div0);

    			if (left_slot) {
    				left_slot.m(div0, null);
    			}

    			append(section, t);
    			append(section, div1);

    			if (right_slot) {
    				right_slot.m(div1, null);
    			}

    			current = true;
    		},
    		p(ctx, [dirty]) {
    			if (left_slot) {
    				if (left_slot.p && dirty & /*$$scope*/ 1) {
    					update_slot(left_slot, left_slot_template, ctx, /*$$scope*/ ctx[0], dirty, get_left_slot_changes, get_left_slot_context);
    				}
    			}

    			if (right_slot) {
    				if (right_slot.p && dirty & /*$$scope*/ 1) {
    					update_slot(right_slot, right_slot_template, ctx, /*$$scope*/ ctx[0], dirty, get_right_slot_changes, get_right_slot_context);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(left_slot, local);
    			transition_in(right_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(left_slot, local);
    			transition_out(right_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(section);
    			if (left_slot) left_slot.d(detaching);
    			if (right_slot) right_slot.d(detaching);
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { $$slots = {}, $$scope } = $$props;

    	$$self.$set = $$props => {
    		if ("$$scope" in $$props) $$invalidate(0, $$scope = $$props.$$scope);
    	};

    	return [$$scope, $$slots];
    }

    class Container extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});
    	}
    }

    /* src/pages/Search.html generated by Svelte v3.24.0 */

    function create_title_slot(ctx) {
    	let h1;

    	return {
    		c() {
    			h1 = element("h1");
    			h1.textContent = "Movie Search";
    			attr(h1, "slot", "title");
    			attr(h1, "class", "svelte-17tivzs");
    		},
    		m(target, anchor) {
    			insert(target, h1, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(h1);
    		}
    	};
    }

    // (4:8) <div class="left" slot="left">
    function create_left_slot(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			div.textContent = "Left";
    			attr(div, "class", "left svelte-17tivzs");
    			attr(div, "slot", "left");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (7:8) <div class="right" slot="right">
    function create_right_slot(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			div.textContent = "Right";
    			attr(div, "class", "right svelte-17tivzs");
    			attr(div, "slot", "right");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (3:4) <Container>
    function create_default_slot(ctx) {
    	let t;

    	return {
    		c() {
    			t = space();
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    function create_fragment$2(ctx) {
    	let div;
    	let navbar;
    	let t;
    	let container;
    	let current;

    	navbar = new NavBar({
    			props: {
    				$$slots: { title: [create_title_slot] },
    				$$scope: { ctx }
    			}
    		});

    	container = new Container({
    			props: {
    				$$slots: {
    					default: [create_default_slot],
    					right: [create_right_slot],
    					left: [create_left_slot]
    				},
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			div = element("div");
    			create_component(navbar.$$.fragment);
    			t = space();
    			create_component(container.$$.fragment);
    			attr(div, "class", "svelte-17tivzs");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			mount_component(navbar, div, null);
    			append(div, t);
    			mount_component(container, div, null);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const navbar_changes = {};

    			if (dirty & /*$$scope*/ 2) {
    				navbar_changes.$$scope = { dirty, ctx };
    			}

    			navbar.$set(navbar_changes);
    			const container_changes = {};

    			if (dirty & /*$$scope*/ 2) {
    				container_changes.$$scope = { dirty, ctx };
    			}

    			container.$set(container_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(navbar.$$.fragment, local);
    			transition_in(container.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(navbar.$$.fragment, local);
    			transition_out(container.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			destroy_component(navbar);
    			destroy_component(container);
    		}
    	};
    }

    function instance$2($$self) {
    	return [];
    }

    class Search extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, {});
    	}
    }

    /* src/App.html generated by Svelte v3.24.0 */

    function create_fragment$3(ctx) {
    	let switch_instance;
    	let switch_instance_anchor;
    	let current;
    	var switch_value = /*page*/ ctx[0];

    	function switch_props(ctx) {
    		return {};
    	}

    	if (switch_value) {
    		switch_instance = new switch_value(switch_props());
    	}

    	return {
    		c() {
    			if (switch_instance) create_component(switch_instance.$$.fragment);
    			switch_instance_anchor = empty();
    		},
    		m(target, anchor) {
    			if (switch_instance) {
    				mount_component(switch_instance, target, anchor);
    			}

    			insert(target, switch_instance_anchor, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			if (switch_value !== (switch_value = /*page*/ ctx[0])) {
    				if (switch_instance) {
    					group_outros();
    					const old_component = switch_instance;

    					transition_out(old_component.$$.fragment, 1, 0, () => {
    						destroy_component(old_component, 1);
    					});

    					check_outros();
    				}

    				if (switch_value) {
    					switch_instance = new switch_value(switch_props());
    					create_component(switch_instance.$$.fragment);
    					transition_in(switch_instance.$$.fragment, 1);
    					mount_component(switch_instance, switch_instance_anchor.parentNode, switch_instance_anchor);
    				} else {
    					switch_instance = null;
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			if (switch_instance) transition_in(switch_instance.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			if (switch_instance) transition_out(switch_instance.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(switch_instance_anchor);
    			if (switch_instance) destroy_component(switch_instance, detaching);
    		}
    	};
    }

    function instance$3($$self) {
    	let page = Search;
    	return [page];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$3, create_fragment$3, safe_not_equal, {});
    	}
    }

    const app = new App({ target: document.body, props: { name: 'SvelteJS'} });

    return app;

}());
