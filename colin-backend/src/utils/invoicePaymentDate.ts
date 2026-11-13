/** Legacy invoices have no paidAt. Keep that fallback explicit until migrated. */
export const invoicePaymentDate = (invoice: any) => invoice?.paidAt || invoice?.updatedAt || null;

export const paidInvoiceRangeQuery = (from: Date, to: Date) => ({
  status: 'Paid',
  $or: [
    { paidAt: { $gte: from, $lte: to } },
    { paidAt: null, updatedAt: { $gte: from, $lte: to } },
  ],
});
