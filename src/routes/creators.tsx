import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, MapPin, Search, Star, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { getCreators } from "@/lib/api";
import { useApp } from "@/lib/i18n";
import type { TKey } from "@/lib/i18n";
import {
  defaultCreatorFilters,
  filterCreators,
  hasActiveFilters,
  type CreatorFilters,
  type CreatorPlatform,
  type FollowerRange,
} from "@/lib/creatorFilters";
import { campaigns, campaignsWithOpenSlots, openSlots, type Campaign } from "@/data/campaigns";
import {
  recentCampaignsFor,
  totalFollowers,
  type Creator,
  type Location,
  type Niche,
} from "@/data/creators";
import { pluralKey } from "@/lib/plural";
import { formatDate } from "@/lib/format";
import { ListState, Panel, StatusBadge, ViewsText } from "@/components/biboh/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/creators")({
  head: () => ({
    meta: [
      { title: "Creators — Biboh" },
      {
        name: "description",
        content: "Browse Tanzanian creators across food, fashion, beauty, comedy and tech.",
      },
      { property: "og:title", content: "Creators — Biboh" },
      {
        property: "og:description",
        content: "Browse Tanzanian creators across food, fashion, beauty, comedy and tech.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CreatorsPage,
});

const nicheKeys: Record<Niche, TKey> = {
  food: "nicheFood",
  fashion: "nicheFashion",
  beauty: "nicheBeauty",
  comedy: "nicheComedy",
  tech: "nicheTech",
};

const niches = Object.keys(nicheKeys) as Niche[];

const locations: Location[] = ["Dar es Salaam", "Arusha", "Mwanza", "Dodoma"];

const followerOptions: { value: FollowerRange; label: string }[] = [
  { value: "under50k", label: "0–50K" },
  { value: "50k-100k", label: "50K–100K" },
  { value: "100k-250k", label: "100K–250K" },
  { value: "250k-plus", label: "250K+" },
];

const ratingOptions = [4, 4.5, 4.8];

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function CreatorsPage() {
  const { t } = useApp();
  const q = useQuery({ queryKey: ["creators"], queryFn: getCreators });
  const [filters, setFilters] = useState<CreatorFilters>(defaultCreatorFilters);
  const [selected, setSelected] = useState<Creator | null>(null);
  const [invites, setInvites] = useState<Record<string, string>>({});

  const all = q.data ?? [];
  const visible = filterCreators(all, filters);
  const filtered = hasActiveFilters(filters);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">{t("creators")}</h1>
        <p className="mt-1 text-muted-foreground">{t("creatorsSub")}</p>
      </div>

      <Panel className="space-y-4">
        <h2 className="font-semibold">{t("filters")}</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="creator-search">{t("searchCreatorsLabel")}</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="creator-search"
                type="search"
                value={filters.query}
                onChange={(event) => setFilters((f) => ({ ...f, query: event.target.value }))}
                placeholder={t("searchCreators")}
                autoComplete="off"
                className="pl-9"
              />
            </div>
          </div>
          {filtered && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setFilters(defaultCreatorFilters)}
            >
              <X className="h-4 w-4" aria-hidden />
              {t("clearFilters")}
            </Button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <FilterSelect
            label={t("niche")}
            value={filters.niche}
            onChange={(value) =>
              setFilters((f) => ({ ...f, niche: value as CreatorFilters["niche"] }))
            }
          >
            <SelectItem value="all">{t("anyNiche")}</SelectItem>
            {niches.map((niche) => (
              <SelectItem key={niche} value={niche}>
                {t(nicheKeys[niche])}
              </SelectItem>
            ))}
          </FilterSelect>

          <FilterSelect
            label={t("platform")}
            value={filters.platform}
            onChange={(value) =>
              setFilters((f) => ({ ...f, platform: value as CreatorPlatform | "all" }))
            }
          >
            <SelectItem value="all">{t("anyPlatform")}</SelectItem>
            <SelectItem value="tiktok">TikTok</SelectItem>
            <SelectItem value="instagram">Instagram</SelectItem>
          </FilterSelect>

          <FilterSelect
            label={t("location")}
            value={filters.location}
            onChange={(value) => setFilters((f) => ({ ...f, location: value as Location | "all" }))}
          >
            <SelectItem value="all">{t("anyLocation")}</SelectItem>
            {locations.map((location) => (
              <SelectItem key={location} value={location}>
                {location}
              </SelectItem>
            ))}
          </FilterSelect>

          <FilterSelect
            label={t("followers")}
            value={filters.followers}
            onChange={(value) => setFilters((f) => ({ ...f, followers: value as FollowerRange }))}
          >
            <SelectItem value="any">{t("anyFollowers")}</SelectItem>
            {followerOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </FilterSelect>

          <FilterSelect
            label={t("minRatingLabel")}
            value={String(filters.minRating)}
            onChange={(value) => setFilters((f) => ({ ...f, minRating: Number(value) }))}
          >
            <SelectItem value="0">{t("anyRating")}</SelectItem>
            {ratingOptions.map((rating) => (
              <SelectItem key={rating} value={String(rating)}>
                {rating.toFixed(1)}+
              </SelectItem>
            ))}
          </FilterSelect>
        </div>
      </Panel>

      {q.isSuccess && (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          <span className="tnum font-semibold text-foreground">{visible.length}</span>{" "}
          {t(pluralKey("creatorFound", "creatorsFound", visible.length))}
        </p>
      )}

      <ListState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={visible.length === 0}
        emptyText={filtered ? t("noCreatorsMatch") : t("emptyCreators")}
        onRetry={() => q.refetch()}
        rows={3}
      >
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((creator) => (
            <li key={creator.id}>
              <button
                type="button"
                onClick={() => setSelected(creator)}
                aria-haspopup="dialog"
                className="group block h-full w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <article className="flex h-full flex-col gap-3 rounded-2xl border bg-card p-5 shadow-soft transition-colors group-hover:border-primary/60">
                  <div className="flex items-start gap-3">
                    <span
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-brand text-sm font-bold text-primary-foreground"
                      aria-hidden
                    >
                      {initials(creator.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-semibold">{creator.name}</h2>
                      <p className="truncate text-xs text-muted-foreground">
                        {creator.handle} · {t(nicheKeys[creator.niche])}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
                      <Star className="h-3 w-3" aria-hidden />
                      <span className="tnum">{creator.rating.toFixed(1)}</span>
                      <span className="sr-only"> {t("rating")}</span>
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                      {creator.location}
                    </span>
                    <span>
                      {creator.pastCampaigns} {t("pastCampaigns")}
                    </span>
                  </div>

                  <p className="mt-auto text-sm">
                    <ViewsText
                      value={totalFollowers(creator)}
                      className="font-semibold text-accent"
                    />{" "}
                    {t("followers")}
                    <span className="text-muted-foreground"> · </span>
                    <ViewsText value={creator.avgViews} className="font-semibold" /> {t("avgViews")}
                  </p>
                </article>
              </button>
            </li>
          ))}
        </ul>
      </ListState>

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-md">
          {selected && (
            <CreatorProfile
              creator={selected}
              invitedCampaignId={invites[selected.id]}
              onInvite={(campaignId) =>
                setInvites((prev) => ({ ...prev, [selected.id]: campaignId }))
              }
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

export function CreatorProfile({
  creator,
  invitedCampaignId,
  onInvite,
}: {
  creator: Creator;
  invitedCampaignId?: string | undefined;
  onInvite: (campaignId: string) => void;
}) {
  const { t, lang } = useApp();
  const [picking, setPicking] = useState(false);
  const inviteOptions = campaignsWithOpenSlots();
  const invited = campaigns.find((c) => c.id === invitedCampaignId);
  const recent = recentCampaignsFor(creator);
  const platforms = [
    { name: "TikTok", value: creator.followers.tiktok },
    { name: "Instagram", value: creator.followers.instagram },
  ];

  const invite = (campaign: Campaign) => {
    onInvite(campaign.id);
    setPicking(false);
    toast.success(t("inviteSent"), {
      description: `${creator.name} · ${campaign.title}`,
    });
  };

  return (
    <div className="space-y-6">
      <SheetHeader className="space-y-3 pr-8 text-left">
        <div className="flex items-center gap-3">
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-brand font-display font-bold text-primary-foreground"
            aria-hidden
          >
            {initials(creator.name)}
          </span>
          <div className="min-w-0">
            <SheetTitle className="truncate">{creator.name}</SheetTitle>
            <SheetDescription className="truncate">
              {creator.handle} · {t(nicheKeys[creator.niche])}
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          {creator.location}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1">
          <Star className="h-3.5 w-3.5 text-accent" aria-hidden />
          <span className="tnum">{creator.rating.toFixed(1)}</span>
          <span className="sr-only">{t("rating")}</span>
        </span>
      </div>

      <section className="space-y-2">
        {invited && (
          <p
            role="status"
            className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            {t("invited")} · {invited.title}
          </p>
        )}
        <Button
          type="button"
          className="w-full"
          aria-expanded={picking}
          aria-controls="invite-picker"
          onClick={() => setPicking((open) => !open)}
        >
          <UserPlus className="h-4 w-4" aria-hidden />
          {t("inviteToCampaign")}
        </Button>

        {picking && (
          <div id="invite-picker" className="space-y-2 rounded-xl border bg-secondary/40 p-3">
            <p className="text-sm font-semibold">{t("invitePickerTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("invitePickerHelp")}</p>
            {inviteOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noOpenSlots")}</p>
            ) : (
              <ul className="space-y-2">
                {inviteOptions.map((campaign) => (
                  <li key={campaign.id}>
                    <button
                      type="button"
                      onClick={() => invite(campaign)}
                      className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {campaign.title}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {campaign.brand} · {t("openSlots")}: {openSlots(campaign)}
                        </span>
                      </span>
                      <StatusBadge status={campaign.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm font-semibold">{t("about")}</h3>
        <p className="text-sm text-muted-foreground">{creator.bio}</p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("followersByPlatform")}</h3>
        <dl className="grid gap-2">
          {platforms.map((platform) => (
            <div
              key={platform.name}
              className="flex items-center justify-between rounded-xl bg-secondary/60 px-3 py-2"
            >
              <dt className="text-sm text-muted-foreground">{platform.name}</dt>
              <dd className="text-sm font-semibold">
                <ViewsText value={platform.value} />{" "}
                <span className="text-xs font-normal text-muted-foreground">{t("followers")}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border p-3">
          <p className="text-xs text-muted-foreground">{t("avgViews")}</p>
          <p className="mt-1 font-display text-lg font-bold">
            <ViewsText value={creator.avgViews} />
          </p>
        </div>
        <div className="rounded-xl border p-3">
          <p className="text-xs text-muted-foreground">{t("pastCampaigns")}</p>
          <p className="mt-1 font-display text-lg font-bold tnum">{creator.pastCampaigns}</p>
        </div>
        <div className="rounded-xl border p-3">
          <p className="text-xs text-muted-foreground">{t("rating")}</p>
          <p className="mt-1 font-display text-lg font-bold tnum">{creator.rating.toFixed(1)}</p>
        </div>
      </section>

      <section aria-label={t("recentCampaigns")} className="space-y-2">
        <h3 className="text-sm font-semibold">{t("recentCampaigns")}</h3>
        <ul className="divide-y rounded-xl border">
          {recent.map((campaign) => (
            <li key={campaign.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{campaign.title}</p>
                <p className="text-xs text-muted-foreground">{formatDate(campaign.date, lang)}</p>
              </div>
              <p className="shrink-0 text-sm">
                <ViewsText value={campaign.views} className="font-semibold" />{" "}
                <span className="text-xs text-muted-foreground">{t("views")}</span>
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
