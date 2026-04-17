import { useQuery } from '@tanstack/react-query'
import { adminRequest } from '../api'

async function fetchDashboardSummary() {
  const [workspaceRes, domainRes, mailboxRes, aliasRes] = await Promise.all([
    adminRequest('/api/v1/platform/workspaces'),
    adminRequest('/api/v1/platform/mail/domains'),
    adminRequest('/api/v1/platform/mail/mailboxes'),
    adminRequest('/api/v1/platform/mail/aliases'),
  ])

  return {
    workspaces: (workspaceRes.items || []).length,
    domains: (domainRes.items || []).length,
    mailboxes: (mailboxRes.items || []).length,
    aliases: (aliasRes.items || []).length,
  }
}

export function useDashboardSummary(enabled) {
  return useQuery({
    queryKey: ['dashboardSummary'],
    queryFn: fetchDashboardSummary,
    enabled,
    staleTime: 30_000,
  })
}
