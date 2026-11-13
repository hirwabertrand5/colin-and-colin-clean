/** Read-only latency check against the configured database; no report data printed. */
const mongoose = require('mongoose');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
require('node:dns').setServers(['8.8.8.8', '1.1.1.1']);
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
async function main() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, socketTimeoutMS: 20000, maxPoolSize: 1, maxConnecting: 1, family: 4, monitorCommands: true, compressors: ['zlib'], zlibCompressionLevel: 3 });
  try {
    const { getFirmReports } = require('../dist/controllers/firmReportsController');
    const inputModule = require('../dist/services/staffProfitabilityInputs');
    const loadInputs = inputModule.loadStaffProfitabilityInputs;
    let captured;
    inputModule.loadStaffProfitabilityInputs = async (...args) => {
      const inputs = await loadInputs(...args); captured = inputs;
      console.log(JSON.stringify({ inputCounts: inputs.map(input => input.length), inputBytes: inputs.map(input => Buffer.byteLength(JSON.stringify(input))) }));
      return inputs;
    };
    console.log('Connected for read-only staff report measurement.');
    const rows = [];
    const selectedRange = process.argv.find(arg => arg.startsWith('--range='))?.split('=')[1];
    for (const range of selectedRange ? [selectedRange] : ['daily', 'monthly', 'ytd']) {
      let status = 200, body, commands = 0;
      const databaseDurations = [];
      const count = e => { if (['find', 'aggregate', 'distinct', 'getMore'].includes(e.commandName)) commands++; };
      const completed = e => { if (['find', 'aggregate', 'distinct', 'getMore'].includes(e.commandName)) databaseDurations.push({ command: e.commandName, milliseconds: e.duration, rows: e.reply?.cursor?.firstBatch?.length ?? e.reply?.cursor?.nextBatch?.length ?? e.reply?.values?.length }); };
      mongoose.connection.getClient().on('commandStarted', count);
      mongoose.connection.getClient().on('commandSucceeded', completed);
      const started = performance.now();
      await getFirmReports({ user: { role: 'managing_partner' }, query: { scope: 'profitability', basis: 'paymentDate', range } },
        { status(code) { status = code; return this; }, json(value) { body = value; return this; } });
      mongoose.connection.getClient().off('commandStarted', count);
      mongoose.connection.getClient().off('commandSucceeded', completed);
      if (status !== 200 || !Array.isArray(body?.team)) throw new Error(`Report failed: ${status} ${body?.message || ''}`);
      rows.push({ range, milliseconds: Math.round(performance.now() - started), readCommands: commands, databaseDurations, staff: body.team.length, responseBytes: Buffer.byteLength(JSON.stringify(body)) });
      console.log(JSON.stringify(rows.at(-1)));
      if (process.argv.includes('--offline-check')) {
        const assert = require('node:assert/strict');
        inputModule.loadStaffProfitabilityInputs = async () => captured;
        let replay;
        const calculationStarted = performance.now();
        await getFirmReports({ user: { role: 'managing_partner' }, query: { scope: 'profitability', basis: 'paymentDate', range } },
          { status() { return this; }, json(value) { replay = value; return this; } });
        assert.deepEqual(replay, body);
        console.log(JSON.stringify({ calculationOnlyMilliseconds: Math.round(performance.now() - calculationStarted), identicalResult: true }));
        if (process.argv.includes('--verify-full-inputs')) {
          const Workflow = require('../dist/models/workflowInstanceModel').default;
          const Task = require('../dist/models/taskModel').default;
          const caseIds = captured[4].map(instance => instance.caseId);
          const fullInstances = await Workflow.find({ caseId: { $in: caseIds } }).select('caseId templateId status deletedStepKeys steps.stepKey steps.title steps.stageKey steps.stageOrder steps.stageTitle steps.stagePercentage steps.percentage steps.order steps.status steps.startAt steps.dueAt steps.completedAt steps.submittedAt steps.reviewedAt steps.doneAt steps.actions.done steps.actions.doneAt steps.tpaSnapshots steps.independentContributors steps.custom steps.archivedFromTemplate').batchSize(500).lean();
          const fullTasks = await Task.find({ caseId: { $in: caseIds } }).select('caseId assignee supervisor title description workflowStepKey workflowStageKey completedAt updatedAt dueDate createdAt startDate checklist qualityScore status taskStages tpaSnapshots').batchSize(500).lean();
          const fullInputs = [...captured]; fullInputs[1] = fullTasks; fullInputs[4] = fullInstances;
          inputModule.loadStaffProfitabilityInputs = async () => fullInputs;
          let fullReport;
          await getFirmReports({ user: { role: 'managing_partner' }, query: { scope: 'profitability', basis: 'paymentDate', range } },
            { status() { return this; }, json(value) { fullReport = value; return this; } });
          assert.deepEqual(fullReport, body, 'Optimized reads must retain every staff count and financial amount');
          console.log(JSON.stringify({ fullInputParity: true, originalTaskRows: fullTasks.length, optimizedTaskRows: captured[1].length }));
        }
        inputModule.loadStaffProfitabilityInputs = loadInputs;
      }
    }
    console.log(JSON.stringify({ databaseReadOnly: true, timingsExcludeConnectionStartup: true, rows }));
  } finally { await mongoose.disconnect(); }
}
main().catch(error => { console.error(String(error.message).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[redacted]')); process.exitCode = 1; });
