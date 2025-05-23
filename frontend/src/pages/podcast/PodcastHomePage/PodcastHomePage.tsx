import "./PodcastHomePage.css"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router"
import { useSessionContext } from "supertokens-auth-react/recipe/session/index"
import LoadingDisplay from "../../../components/LoadingDisplay/LoadingDisplay.tsx"
import SearchBar from "../../../components/SearchBar/SearchBar.tsx"
import TrendingPodcastSection from "../../../features/podcast/trending/TrendingPodcastSection/TrendingPodcastSection.tsx"
import PodcastCategorySection from "../../../features/podcast/category/PodcastCategorySection/PodcastCategorySection.tsx"
import useTrendingPodcasts from "../../../hooks/podcast/useTrendingPodcasts.ts"
import usePodcastCategory from "../../../hooks/podcast/usePodcastCategory.ts"
import usePodcastSearch from "../../../hooks/podcast/usePodcastSearch.ts"
import PodcastSearchResultList from "../../../features/podcast/search/PodcastSearchResultList/PodcastSearchResultList.tsx"
import { TrendingPodcastFiltersType } from "../../../api/podcast/model/podcast.ts"
import Button from "../../../components/ui/button/Button.tsx"
import { profileHistoryPage } from "../../../paths.ts"

const LIMIT = 10

export default function PodcastHomePage() {
  const session = useSessionContext()
  const navigate = useNavigate()
  const options = useMemo(() => {
    return {
      limit: LIMIT,
    }
  }, [])
  const {
    loading: loadingSearchPodcasts,
    podcasts: searchPodcasts,
    fetchPodcastsBySearchQuery,
  } = usePodcastSearch()
  const {
    DEFAULT_SINCE_DAYS,
    trendingPodcasts,
    loading: loadingTrendingPodcasts,
    onRefresh: handleTrendingPodcastRefresh,
  } = useTrendingPodcasts(options)
  const [sinceDaysBefore, setSinceDaysBefore] =
    useState<number>(DEFAULT_SINCE_DAYS)
  const initialFilters: TrendingPodcastFiltersType = useMemo(() => {
    return { since: DEFAULT_SINCE_DAYS }
  }, [DEFAULT_SINCE_DAYS])
  const {
    loading: loadingCategories,
    categories,
    onRefresh: handlePodcastCategoryRefresh,
  } = usePodcastCategory()

  const handlePodcastRefresh = useCallback(
    async (filters: TrendingPodcastFiltersType) => {
      if (filters != null) {
        const { since } = filters
        setSinceDaysBefore(since)
      }
      await handleTrendingPodcastRefresh(filters)
    },
    [handleTrendingPodcastRefresh]
  )

  const handlePodcastSearch = useCallback(
    async (query: string) => {
      const podcastSearchLimit = 10
      fetchPodcastsBySearchQuery(query, podcastSearchLimit)
    },
    [fetchPodcastsBySearchQuery]
  )

  const handleNavigateToProfileHistory = useCallback(() => {
    navigate(profileHistoryPage())
  }, [navigate])

  useEffect(() => {
    document.title = "xtal - podcasts"
    Promise.allSettled([
      handlePodcastCategoryRefresh(),
      handlePodcastRefresh({ since: sinceDaysBefore }),
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div id="podcast-home-page-container">
      {session && !session.loading && session.doesSessionExist && (
        <Button
          keyProp="podcast-home-page-profile-history-button"
          className="podcast-home-page-profile-history-button"
          onClick={handleNavigateToProfileHistory}
          variant="secondary"
          title="Profile History"
        >
          Profile History
        </Button>
      )}
      <div>
        <SearchBar
          className="podcast-search-bar"
          placeholder="Search Podcasts..."
          onChange={handlePodcastSearch}
        />
        <LoadingDisplay loading={loadingSearchPodcasts}>
          <PodcastSearchResultList results={searchPodcasts} />
        </LoadingDisplay>
      </div>
      <LoadingDisplay loading={loadingCategories}>
        <PodcastCategorySection
          categories={categories}
          onRefresh={handlePodcastCategoryRefresh}
        />
      </LoadingDisplay>
      <TrendingPodcastSection
        trendingPodcasts={trendingPodcasts}
        onRefresh={handlePodcastRefresh}
        filters={initialFilters}
        loading={loadingTrendingPodcasts}
      />
    </div>
  )
}
