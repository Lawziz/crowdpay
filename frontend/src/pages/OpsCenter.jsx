import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../components/ops/opsStyles';

const OpsAuthPanel = lazy(() => import('../components/ops/OpsAuthPanel'));
const OpsOverviewPanel = lazy(() => import('../components/ops/OpsOverviewPanel'));
const OpsIncidentPanel = lazy(() => import('../components/ops/OpsIncidentPanel'));
const OpsWalletAuditPanel = lazy(() => import('../components/ops/OpsWalletAuditPanel'));
const OpsRunbookModal = lazy(() => import('../components/ops/OpsRunbookModal'));
const OpsMetricHistoryModal = lazy(() => import('../components/ops/OpsMetricHistoryModal'));

const panelFallback = <p style={{ color: '#94a3b8' }}>Loading operations panel…</p>;

export default function OpsCenter() {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState(
    () => sessionStorage.getItem('cp_ops_api_key') || localStorage.getItem('cp_ops_api_key') || ''
  );
  const [tempKey, setTempKey] = useState('');
  const [rememberKey, setRememberKey] = useState(false);
  const [authError, setAuthError] = useState('');

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [healthData, setHealthData] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [incidentTab, setIncidentTab] = useState('open'); // 'open' | 'resolved'
  const [resolvedIncidents, setResolvedIncidents] = useState([]);
  const [walletAudit, setWalletAudit] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Runbook execution modal state
  const [activeRunbookModal, setActiveRunbookModal] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [runbookExecuting, setRunbookExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState(null);

  // Metric history modal state
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyMetric, setHistoryMetric] = useState('horizon_testnet_latency_ms');
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchWithAuth = useCallback(
    async (url, options = {}) => {
      const headers = {
        'Content-Type': 'application/json',
        ops_api_key: apiKey,
        ...options.headers,
      };
      // OpsCenter is API-key authenticated, but same-origin browsers still
      // carry the `cp_csrf` cookie, so mutating requests must echo it in the
      // x-csrf-token header or the global csrfProtection middleware rejects
      // them with 403 (#801).
      if (
        options.method &&
        options.method.toUpperCase() !== 'GET' &&
        typeof document !== 'undefined'
      ) {
        const match = document.cookie.match(/(?:^|; )cp_csrf=([^;]*)/);
        if (match) headers['x-csrf-token'] = decodeURIComponent(match[1]);
      }
      const res = await fetch(url, { ...options, headers });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('cp_ops_api_key');
        sessionStorage.removeItem('cp_ops_api_key');
        throw new Error(res.status === 403 ? 'FORBIDDEN_OPS' : 'UNAUTHORIZED_OPS');
      }
      return res;
    },
    [apiKey]
  );

  const loadDashboardData = useCallback(
    async (isRefresh = false) => {
      if (!apiKey) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setErrorMsg('');

      try {
        // 1. Health data
        const healthRes = await fetchWithAuth(`/api/ops/health${isRefresh ? '?fresh=true' : ''}`);
        if (healthRes.ok) {
          const hJson = await healthRes.json();
          setHealthData(hJson.data);
        }

        // 2. Open Incidents
        const openIncRes = await fetchWithAuth('/api/ops/incidents?status=open');
        if (openIncRes.ok) {
          const incJson = await openIncRes.json();
          setIncidents(incJson.incidents || []);
        }

        // 3. Resolved Incidents
        const resIncRes = await fetchWithAuth('/api/ops/incidents?status=resolved&limit=10');
        if (resIncRes.ok) {
          const resJson = await resIncRes.json();
          setResolvedIncidents(resJson.incidents || []);
        }

        // 4. Wallet audit
        const auditRes = await fetchWithAuth('/api/ops/campaigns/wallet-audit');
        if (auditRes.ok) {
          const aJson = await auditRes.json();
          setWalletAudit(aJson.wallets || []);
        }
      } catch (err) {
        if (err.message === 'UNAUTHORIZED_OPS' || err.message === 'FORBIDDEN_OPS') {
          setAuthError(
            err.message === 'FORBIDDEN_OPS'
              ? 'Access forbidden: Insufficient permissions for OPS_API_KEY.'
              : 'Authentication failed: Invalid OPS_API_KEY.'
          );
          setApiKey('');
          localStorage.removeItem('cp_ops_api_key');
          sessionStorage.removeItem('cp_ops_api_key');
        } else {
          setErrorMsg(err.message || 'Failed to fetch operations data.');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiKey, fetchWithAuth]
  );

  // Initial load and 30s auto-refresh
  useEffect(() => {
    if (apiKey) {
      loadDashboardData();
      const interval = setInterval(() => loadDashboardData(true), 30000);
      return () => clearInterval(interval);
    }
  }, [apiKey, loadDashboardData]);

  const handleKeySubmit = (e) => {
    e.preventDefault();
    if (!tempKey.trim()) return;
    const clean = tempKey.trim();
    if (rememberKey) {
      localStorage.setItem('cp_ops_api_key', clean);
      sessionStorage.removeItem('cp_ops_api_key');
    } else {
      sessionStorage.setItem('cp_ops_api_key', clean);
      localStorage.removeItem('cp_ops_api_key');
    }
    setAuthError('');
    setApiKey(clean);
  };

  const handleLogout = () => {
    localStorage.removeItem('cp_ops_api_key');
    sessionStorage.removeItem('cp_ops_api_key');
    setApiKey('');
    setHealthData(null);
  };

  const handleAcknowledge = async (incidentId) => {
    try {
      const res = await fetchWithAuth(`/api/ops/incidents/${incidentId}/acknowledge`, {
        method: 'POST',
      });
      if (res.ok) {
        await loadDashboardData(true);
      }
    } catch (err) {
      window.alert(`Failed to acknowledge incident: ${err.message}`);
    }
  };

  const handleOpenRunbook = (incident) => {
    setSelectedIncident(incident);
    setExecutionResult(null);
    setActiveRunbookModal(true);
  };

  const handleExecuteRunbook = async () => {
    if (!selectedIncident) return;
    setRunbookExecuting(true);
    try {
      const res = await fetchWithAuth(`/api/ops/runbooks/${selectedIncident.id}/execute`, {
        method: 'POST',
      });
      if (res.ok) {
        const json = await res.json();
        setExecutionResult(json.execution);
        await loadDashboardData(true);
      } else {
        const errJson = await res.json();
        window.alert(`Runbook execution failed: ${errJson.error?.message || 'Unknown error'}`);
      }
    } catch (err) {
      window.alert(`Runbook error: ${err.message}`);
    } finally {
      setRunbookExecuting(false);
    }
  };

  const handleApproveWalletFunding = async (campaignId) => {
    try {
      const res = await fetchWithAuth(
        `/api/ops/campaigns/wallet-audit/${campaignId}/approve-funding`,
        {
          method: 'POST',
        }
      );
      if (res.ok) {
        const json = await res.json();
        window.alert(json.message);
        await loadDashboardData(true);
      }
    } catch (err) {
      window.alert(`Failed to approve funding: ${err.message}`);
    }
  };

  const handleOpenHistory = async (metricName) => {
    setHistoryMetric(metricName);
    setHistoryModalOpen(true);
    setHistoryLoading(true);
    try {
      const res = await fetchWithAuth(`/api/ops/metrics/history?metric=${metricName}&limit=50`);
      if (res.ok) {
        const json = await res.json();
        const formatted = (json.history || []).map((h) => ({
          time: new Date(h.collected_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
          value: parseFloat(h.metric_value),
        }));
        setHistoryData(formatted);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setHistoryLoading(false);
    }
  };

  if (!apiKey) {
    return (
      <Suspense fallback={panelFallback}>
        <OpsAuthPanel
          t={t}
          authError={authError}
          tempKey={tempKey}
          setTempKey={setTempKey}
          rememberKey={rememberKey}
          setRememberKey={setRememberKey}
          handleKeySubmit={handleKeySubmit}
        />
      </Suspense>
    );
  }

  return (
    <div style={styles.pageContainer}>
      {/* Header */}
      <div style={styles.headerRow}>
        <div>
          <div style={styles.tagline}>OPERATIONAL TELEMETRY & INCIDENT RESPONSE</div>
          <h1 style={styles.pageTitle}>System Health & Operations Centre</h1>
        </div>

        <div style={styles.headerActions}>
          <button
            onClick={() => loadDashboardData(true)}
            disabled={refreshing}
            style={styles.refreshBtn}
          >
            {refreshing ? 'Refreshing...' : '↻ Refresh Telemetry'}
          </button>
          <button onClick={handleLogout} style={styles.secondaryBtn}>
            Lock / Change Key
          </button>
        </div>
      </div>

      {errorMsg && <div style={styles.errorAlert}>{errorMsg}</div>}

      <Suspense fallback={panelFallback}>
        <OpsOverviewPanel healthData={healthData} handleOpenHistory={handleOpenHistory} />
      </Suspense>
      <Suspense fallback={panelFallback}>
        <OpsIncidentPanel
          incidentTab={incidentTab}
          setIncidentTab={setIncidentTab}
          incidents={incidents}
          resolvedIncidents={resolvedIncidents}
          handleAcknowledge={handleAcknowledge}
          handleOpenRunbook={handleOpenRunbook}
        />
      </Suspense>
      <Suspense fallback={panelFallback}>
        <OpsWalletAuditPanel
          walletAudit={walletAudit}
          handleApproveWalletFunding={handleApproveWalletFunding}
        />
      </Suspense>
      {activeRunbookModal && (
        <Suspense fallback={panelFallback}>
          <OpsRunbookModal
            activeRunbookModal={activeRunbookModal}
            selectedIncident={selectedIncident}
            setActiveRunbookModal={setActiveRunbookModal}
            executionResult={executionResult}
            runbookExecuting={runbookExecuting}
            handleExecuteRunbook={handleExecuteRunbook}
          />
        </Suspense>
      )}
      {historyModalOpen && (
        <Suspense fallback={panelFallback}>
          <OpsMetricHistoryModal
            historyModalOpen={historyModalOpen}
            setHistoryModalOpen={setHistoryModalOpen}
            historyMetric={historyMetric}
            historyLoading={historyLoading}
            historyData={historyData}
          />
        </Suspense>
      )}
    </div>
  );
}
