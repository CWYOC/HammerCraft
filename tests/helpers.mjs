import fs from 'node:fs';
import vm from 'node:vm';

export const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
export const quiet = { log() {}, error() {}, warn() {} };

export function dom() {
    const nodes = new Map();
    function element() {
        return { value: '', hidden: true, checked: true, disabled: false, dataset: {}, textContent: '', children: [],
            addEventListener() {}, replaceChildren() { this.children = []; },
            appendChild(child) { this.children.push(child); },
            querySelectorAll() { return []; }, classList: { add() {}, remove() {} } };
    }
    return {
        nodes,
        getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
        createElement: element, addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; },
    };
}

export function browserContext(file, window = {}) {
    const document = dom();
    const location = { href: 'https://example.test/', search: '' };
    const context = vm.createContext({ document, window: { location, history: { replaceState() {} }, addEventListener() {}, ...window },
        console: quiet, URL, URLSearchParams, structuredClone, crypto: globalThis.crypto, localStorage: { getItem: () => null },
    });
    const source = read(file).replace(/initialise(?:Order|EarScan|Basket)\(\);\s*$/, '');
    vm.runInContext(source, context, { filename: file });
    return context;
}
