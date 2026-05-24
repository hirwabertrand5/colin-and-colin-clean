const API_URL = import.meta.env.VITE_API_URL;

export interface CaseDocument {
  _id?: string;
  caseId: string;
  name: string;

  category?: string;

  // ✅ workflow linkage (optional)
  workflowInstanceId?: string;
  stepKey?: string;
  outputKey?: string;

  uploadedBy: string;
  uploadedDate: string;
  size: string;
  url: string;
}

const getToken = () => localStorage.getItem('token');

export const getDocumentsForCase = async (caseId: string): Promise<CaseDocument[]> => {
  const res = await fetch(`${API_URL}/cases/${caseId}/documents`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) {
    throw new Error((await res.json()).message || 'Failed to fetch documents');
  }

  return res.json();
};

export const addDocumentToCase = async (
  caseId: string,
  doc: {
    name: string;
    file: File;
    category?: string;
    workflowInstanceId?: string;
    stepKey?: string;
    outputKey?: string;
  }
): Promise<CaseDocument> => {
  const formData = new FormData();
  formData.append('name', doc.name);
  formData.append('file', doc.file);

  if (doc.category) formData.append('category', doc.category);
  if (doc.workflowInstanceId) formData.append('workflowInstanceId', doc.workflowInstanceId);
  if (doc.stepKey) formData.append('stepKey', doc.stepKey);
  if (doc.outputKey) formData.append('outputKey', doc.outputKey);

  const res = await fetch(`${API_URL}/cases/${caseId}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });

  if (!res.ok) {
    throw new Error((await res.json()).message || 'Failed to create document');
  }

  return res.json();
};

export const deleteDocument = async (docId: string): Promise<void> => {
  const res = await fetch(`${API_URL}/documents/${docId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) {
    throw new Error((await res.json()).message || 'Failed to delete document');
  }
};