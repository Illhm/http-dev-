import fs from 'fs';
import vm from 'vm';

let code = fs.readFileSync('bg.js', 'utf8');
// Replace const with var to make it accessible in the context
code = code.replace(/^const state =/m, 'var state =');
code = code.replace(/^const sessionToTab =/m, 'var sessionToTab =');
code = code.replace(/^const autoAttachedTabs =/m, 'var autoAttachedTabs =');

function createMockChrome(delay = 10) {
  return {
    debugger: {
      sendCommand: ({ tabId }, method, params) => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({}), delay);
        });
      },
      detach: ({ tabId }) => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({}), delay);
        });
      },
      onEvent: { addListener: () => {}, removeListener: () => {} },
      onDetach: { addListener: () => {}, removeListener: () => {} }
    },
    runtime: {
      sendMessage: () => {},
      getURL: () => '',
      onMessage: { addListener: () => {} }
    },
    webNavigation: {
      onBeforeNavigate: {
        addListener: () => {}
      }
    }
  };
}

async function runBench(numTabs, delay) {
  const chrome = createMockChrome(delay);
  const context = {
    chrome,
    console,
    Set,
    Map,
    Promise,
    Array,
    setTimeout,
    Date,
    Math,
    String
  };
  vm.createContext(context);
  vm.runInNewContext(code, context);

  const { state, stopCapture, applyCacheDisabled, applyThrottle } = context;

  // Setup state
  for (let i = 1; i <= numTabs; i++) {
    state.attachedTabs.add(i);
  }
  state.attached = true;

  console.log(`--- Benchmarking with ${numTabs} tabs, ${delay}ms delay per command ---`);

  let start = Date.now();
  await applyCacheDisabled();
  let end = Date.now();
  console.log(`applyCacheDisabled: ${end - start}ms`);

  start = Date.now();
  await applyThrottle();
  end = Date.now();
  console.log(`applyThrottle: ${end - start}ms`);

  start = Date.now();
  await stopCapture();
  end = Date.now();
  console.log(`stopCapture: ${end - start}ms`);
  console.log('');
}

async function main() {
  await runBench(10, 10);
  await runBench(50, 2);
}

main();
