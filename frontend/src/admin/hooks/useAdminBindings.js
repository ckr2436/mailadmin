import { useQuery } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function fetchAdminBindings(username) {
  return adminRequest(`/api/v1/platform/admin-users/${encodeURIComponent(username)}/workspaces`)
}

export function useAdminBindings(username, enabled) {
  return useQuery({
    queryKey: ['adminBindings', username || ''],
    queryFn: async () => {
      const data = await fetchAdminBindings(username)
      return data.items || []
    },
    enabled: Boolean(username) && enabled,
    staleTime: 30_000,
  })
}
