// Monte Carlo off the page's main thread (WP40): the Pricer posts note parameters, this returns the simulated legs.
importScripts('sp-model.js');
onmessage = e => {
  const { id, kind, p } = e.data;
  try { postMessage({ id, res: kind === 'acc' ? SPM.accumulator(p) : SPM.mcNote(p) }); }
  catch (err) { postMessage({ id, error: String(err) }); }
};
