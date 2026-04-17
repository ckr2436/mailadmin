import { useQuery } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useWorkspaces(enabled) {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: () => adminRequest('/api/v1/platform/workspaces'),
    enabled,
    select: (data) => data.items || [],
    staleTime: 30_000,
  })
}
