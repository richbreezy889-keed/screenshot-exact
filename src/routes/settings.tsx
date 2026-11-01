import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bell, Building2, KeyRound, Megaphone, Users } from "lucide-react";
import { useApp, type TKey } from "@/lib/i18n";
import { Panel } from "@/components/biboh/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

type SectionId = "company" | "language" | "notifications" | "team" | "security";

const SECTIONS: { id: SectionId; icon: typeof Building2; label: TKey }[] = [
  { id: "company", icon: Building2, label: "settingsCompany" },
  { id: "language", icon: Megaphone, label: "settingsLanguage" },
  { id: "notifications", icon: Bell, label: "settingsNotifications" },
  { id: "team", icon: Users, label: "settingsTeam" },
  { id: "security", icon: KeyRound, label: "settingsSecurity" },
];

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
}

const INITIAL_MEMBERS: Member[] = [
  { id: "m1", name: "Rafiki M", email: "rafiki@zuri.co.tz", role: "Owner" },
  { id: "m2", name: "Amina K", email: "amina@zuri.co.tz", role: "Manager" },
  { id: "m3", name: "Baraka J", email: "baraka@zuri.co.tz", role: "Viewer" },
];

interface NotificationSetting {
  enabled: boolean;
  channels: { inApp: boolean; email: boolean; whatsapp: boolean };
}

const NOTIFICATION_DEFAULTS: Record<string, NotificationSetting> = {
  applicant: { enabled: true, channels: { inApp: true, email: false, whatsapp: false } },
  video: { enabled: true, channels: { inApp: true, email: true, whatsapp: false } },
  checkpoint: { enabled: true, channels: { inApp: false, email: true, whatsapp: true } },
  payout: { enabled: true, channels: { inApp: true, email: false, whatsapp: true } },
  lowBalance: { enabled: false, channels: { inApp: true, email: false, whatsapp: false } },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^(\+255|0)\d{9}$/;

export function SettingsPage() {
  const { t, lang, setLang } = useApp();
  const [section, setSection] = useState<SectionId>("company");

  const [brandName, setBrandName] = useState("Zuri Beauty");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("https://zuri.example.tz");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("hello@zuri.example.tz");
  const [logoName, setLogoName] = useState<string | null>(null);

  const [notifications, setNotifications] =
    useState<Record<string, NotificationSetting>>(NOTIFICATION_DEFAULTS);
  const [members, setMembers] = useState<Member[]>(INITIAL_MEMBERS);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Viewer");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const saveCompany = () => {
    const valid =
      brandName.trim().length > 0 && EMAIL_RE.test(contactEmail) && PHONE_RE.test(contactPhone);
    if (!valid) {
      toast.error(t("settingsSaved"));
      return;
    }
    toast.success(t("settingsSaved"));
  };

  const saveSecurity = () => {
    if (newPassword.length < 8 || newPassword !== confirmPassword) {
      toast.error(t("settingsSaved"));
      return;
    }
    toast.success(t("settingsSaved"));
  };

  const inviteMember = () => {
    if (!inviteName.trim() || !EMAIL_RE.test(inviteEmail)) {
      return;
    }
    setMembers((prev) => [
      ...prev,
      { id: `m-${Date.now()}`, name: inviteName.trim(), email: inviteEmail, role: inviteRole },
    ]);
    setInviteOpen(false);
    setInviteName("");
    setInviteEmail("");
    setInviteRole("Viewer");
    toast.success(t("teamInviteSuccess"));
  };

  const removeMember = (id: string) => {
    if (members.find((m) => m.id === id)?.role === "Owner") {
      return;
    }
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const tabs: { id: SectionId; icon: typeof Building2; label: TKey }[] = [
    { id: "company", icon: Building2, label: "settingsCompany" },
    { id: "language", icon: Megaphone, label: "settingsLanguage" },
    { id: "notifications", icon: Bell, label: "settingsNotifications" },
    { id: "team", icon: Users, label: "settingsTeam" },
    { id: "security", icon: KeyRound, label: "settingsSecurity" },
  ];

  const notificationKeys = Object.keys(
    NOTIFICATION_DEFAULTS,
  ) as (keyof typeof NOTIFICATION_DEFAULTS)[];

  const notificationLabel = (key: string): TKey => {
    switch (key) {
      case "applicant":
        return "notifNewApplicant";
      case "video":
        return "notifVideoSubmitted";
      case "checkpoint":
        return "notifCheckpoint";
      case "payout":
        return "notifPayoutReleased";
      default:
        return "notifLowBalance";
    }
  };

  const toggleEnabled = (key: string, value: boolean) => {
    setNotifications((prev) => {
      const current = prev[key] as NotificationSetting;
      return { ...prev, [key]: { ...current, enabled: value } };
    });
  };

  const toggleChannel = (key: string, channel: "inApp" | "email" | "whatsapp", value: boolean) => {
    setNotifications((prev) => {
      const current = prev[key] as NotificationSetting;
      const channels = { ...current.channels };
      channels[channel] = value;
      return { ...prev, [key]: { ...current, channels } };
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">{t("settings")}</h1>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("settings")}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = section === tab.id;
          return (
            <Button
              key={tab.id}
              type="button"
              variant={active ? "default" : "outline"}
              size="sm"
              role="tab"
              aria-selected={active}
              onClick={() => setSection(tab.id)}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t(tab.label)}
            </Button>
          );
        })}
      </div>

      {section === "company" && (
        <Panel className="space-y-4">
          <h2 className="font-semibold">{t("settingsCompany")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="company-brand">{t("settingsBrand")}</Label>
              <Input
                id="company-brand"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-industry">{t("settingsIndustry")}</Label>
              <Input
                id="company-industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-website">{t("settingsWebsite")}</Label>
              <Input
                id="company-website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-phone">{t("settingsContactPhone")}</Label>
              <Input
                id="company-phone"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-email">{t("settingsContactEmail")}</Label>
              <Input
                id="company-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-logo">{t("settingsLogo")}</Label>
              <Input
                id="company-logo"
                type="file"
                accept="image/*"
                onChange={(e) => setLogoName(e.target.files?.[0]?.name ?? null)}
              />
              {logoName && <p className="text-xs text-muted-foreground">{logoName}</p>}
            </div>
          </div>
          <Button type="button" onClick={saveCompany}>
            {t("settingsSave")}
          </Button>
        </Panel>
      )}

      {section === "language" && (
        <Panel className="space-y-4">
          <h2 className="font-semibold">{t("settingsLanguage")}</h2>
          <div className="flex items-center gap-3">
            {(["en", "sw"] as const).map((l) => (
              <Button
                key={l}
                type="button"
                variant={lang === l ? "default" : "outline"}
                onClick={() => setLang(l)}
              >
                {l === "en" ? "EN" : "SW"}
              </Button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("currencyTZS")}</Label>
              <Input value="TZS" readOnly disabled />
            </div>
            <div className="space-y-1.5">
              <Label>{t("timezoneLabel")}</Label>
              <Input value={t("timezoneDar")} readOnly disabled />
            </div>
          </div>
        </Panel>
      )}

      {section === "notifications" && (
        <Panel className="space-y-4">
          <h2 className="font-semibold">{t("settingsNotifications")}</h2>
          {notificationKeys.map((key) => {
            const setting = notifications[key];
            const labelKey = notificationLabel(key);
            if (!setting) return null;
            return (
              <div key={key} className="space-y-2 rounded-xl border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{t(labelKey)}</p>
                  <Switch
                    checked={setting.enabled}
                    onCheckedChange={(checked) => toggleEnabled(key, checked)}
                    aria-label={t(labelKey)}
                  />
                </div>
                {setting.enabled && (
                  <div className="flex flex-wrap gap-4 pl-0 pt-1">
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={setting.channels.inApp}
                        onCheckedChange={(checked) => toggleChannel(key, "inApp", checked)}
                        aria-label={t("channelInApp")}
                      />
                      {t("channelInApp")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={setting.channels.email}
                        onCheckedChange={(checked) => toggleChannel(key, "email", checked)}
                        aria-label={t("channelEmail")}
                      />
                      {t("channelEmail")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={setting.channels.whatsapp}
                        onCheckedChange={(checked) => toggleChannel(key, "whatsapp", checked)}
                        aria-label={t("channelWhatsApp")}
                      />
                      {t("channelWhatsApp")}
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </Panel>
      )}

      {section === "team" && (
        <Panel className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">{t("settingsTeam")}</h2>
            <Button type="button" onClick={() => setInviteOpen(true)}>
              <Users className="h-4 w-4" aria-hidden />
              {t("inviteMember")}
            </Button>
          </div>
          <ul className="divide-y">
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{member.name}</p>
                  <p className="text-xs text-muted-foreground">{member.email}</p>
                </div>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold">
                  {t(
                    member.role === "Owner"
                      ? "teamRoleOwner"
                      : member.role === "Manager"
                        ? "teamRoleManager"
                        : "teamRoleViewer",
                  )}
                </span>
                {member.role !== "Owner" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeMember(member.id)}
                  >
                    {t("removeMember")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t("ownerCantBeRemoved")}</p>
        </Panel>
      )}

      {section === "security" && (
        <Panel className="space-y-4">
          <h2 className="font-semibold">{t("settingsSecurity")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="security-current">{t("currentPassword")}</Label>
              <Input
                id="security-current"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="security-new">{t("newPassword")}</Label>
              <Input
                id="security-new"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="security-confirm">{t("confirmPassword")}</Label>
              <Input
                id="security-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="security-2fa">{t("twoFactor")}</Label>
              <Input id="security-2fa" value={t("twoFactorPlaceholder")} readOnly disabled />
            </div>
          </div>
          <Button type="button" onClick={saveSecurity}>
            {t("settingsSave")}
          </Button>
        </Panel>
      )}

      <Dialog open={inviteOpen} onOpenChange={(open) => !open && setInviteOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("inviteMember")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-name">{t("teamInviteName")}</Label>
              <Input
                id="invite-name"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">{t("teamInviteEmail")}</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">{t("teamInviteRole")}</Label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                <option value="Owner">Owner</option>
                <option value="Manager">Manager</option>
                <option value="Viewer">Viewer</option>
              </select>
            </div>
            <Button
              type="button"
              onClick={inviteMember}
              disabled={!inviteName.trim() || !EMAIL_RE.test(inviteEmail)}
            >
              {t("teamInviteSuccess")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});
