const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export const attachWorkflowOutput = async (params: {
  caseId: string;
  stepKey: string;
  outputKey: string;
  documentId: string;
}) => {
  const res = await fetch(
    `${API_URL}/workflows/cases/${params.caseId}/steps/${params.stepKey}/outputs/${params.outputKey}/attach`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ documentId: params.documentId }),
    }
  );

  if (!res.ok) {
    throw new Error((await res.json()).message || 'Failed to attach output');
  }

  return res.json();
};