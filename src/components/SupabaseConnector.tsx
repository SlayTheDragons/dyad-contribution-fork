import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";

import { Label } from "@/components/ui/label";

import { IpcClient } from "@/ipc/ipc_client";
import { toast } from "sonner";
import { useSettings } from "@/hooks/useSettings";
import { useSupabase } from "@/hooks/useSupabase";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { Badge } from "@/components/ui/badge";

// @ts-ignore
import supabaseLogoLight from "../../assets/supabase/supabase-logo-wordmark--light.svg";
// @ts-ignore
import supabaseLogoDark from "../../assets/supabase/supabase-logo-wordmark--dark.svg";
// @ts-ignore
import connectSupabaseDark from "../../assets/supabase/connect-supabase-dark.svg";
// @ts-ignore
import connectSupabaseLight from "../../assets/supabase/connect-supabase-light.svg";

import { ExternalLink } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

export function SupabaseConnector({ appId }: { appId: number }) {
  const { settings, refreshSettings } = useSettings();
  const { app, refreshApp } = useLoadApp(appId);
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  const { isDarkMode } = useTheme();
  const normalizedFiles = useMemo(() => {
    const files = app?.files ?? [];
    return files.map((filePath) => filePath.replace(/\\/g, "/"));
  }, [app?.files]);
  const { functionFolders, sharedModuleFiles } = useMemo(() => {
    const SUPABASE_FUNCTIONS_PREFIX = "supabase/functions/";
    const SUPABASE_SHARED_PREFIX = `${SUPABASE_FUNCTIONS_PREFIX}_shared/`;

    const functionFolderSet = new Set<string>();
    const sharedFiles: string[] = [];

    for (const filePath of normalizedFiles) {
      if (!filePath.startsWith(SUPABASE_FUNCTIONS_PREFIX)) {
        continue;
      }

      if (filePath.startsWith(SUPABASE_SHARED_PREFIX)) {
        const relativeSharedPath = filePath.slice(SUPABASE_SHARED_PREFIX.length);
        if (relativeSharedPath) {
          sharedFiles.push(relativeSharedPath);
        }
        continue;
      }

      const relativePath = filePath.slice(SUPABASE_FUNCTIONS_PREFIX.length);
      if (!relativePath) {
        continue;
      }

      if (!relativePath.includes("/")) {
        continue;
      }

      const [firstSegment] = relativePath.split("/");
      if (!firstSegment) {
        continue;
      }

      functionFolderSet.add(firstSegment);
    }

    return {
      functionFolders: Array.from(functionFolderSet).sort((a, b) =>
        a.localeCompare(b),
      ),
      sharedModuleFiles: sharedFiles.sort((a, b) => a.localeCompare(b)),
    };
  }, [normalizedFiles]);
  useEffect(() => {
    const handleDeepLink = async () => {
      if (lastDeepLink?.type === "supabase-oauth-return") {
        await refreshSettings();
        await refreshApp();
        clearLastDeepLink();
      }
    };
    handleDeepLink();
  }, [lastDeepLink?.timestamp]);
  const {
    projects,
    loading,
    error,
    loadProjects,
    branches,
    loadBranches,
    setAppProject,
    unsetAppProject,
  } = useSupabase();
  const currentProjectId = app?.supabaseProjectId;

  useEffect(() => {
    // Load projects when the component mounts and user is connected
    if (settings?.supabase?.accessToken) {
      loadProjects();
    }
  }, [settings?.supabase?.accessToken, loadProjects]);

  const handleProjectSelect = async (projectId: string) => {
    try {
      await setAppProject({ projectId, appId });
      toast.success("Project connected to app successfully");
      await refreshApp();
    } catch (error) {
      toast.error("Failed to connect project to app: " + error);
    }
  };

  const projectIdForBranches =
    app?.supabaseParentProjectId || app?.supabaseProjectId;
  useEffect(() => {
    if (projectIdForBranches) {
      loadBranches(projectIdForBranches);
    }
  }, [projectIdForBranches, loadBranches]);

  const handleUnsetProject = async () => {
    try {
      await unsetAppProject(appId);
      toast.success("Project disconnected from app successfully");
      await refreshApp();
    } catch (error) {
      console.error("Failed to disconnect project:", error);
      toast.error("Failed to disconnect project from app");
    }
  };

  if (settings?.supabase?.accessToken) {
    if (app?.supabaseProjectName) {
      return (
        <Card className="mt-1">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Supabase Project{" "}
              <Button
                variant="outline"
                onClick={() => {
                  IpcClient.getInstance().openExternalUrl(
                    `https://supabase.com/dashboard/project/${app.supabaseProjectId}`,
                  );
                }}
                className="ml-2 px-2 py-1"
                style={{ display: "inline-flex", alignItems: "center" }}
                asChild
              >
                <div className="flex items-center gap-2">
                  <img
                    src={isDarkMode ? supabaseLogoDark : supabaseLogoLight}
                    alt="Supabase Logo"
                    style={{ height: 20, width: "auto", marginRight: 4 }}
                  />
                  <ExternalLink className="h-4 w-4" />
                </div>
              </Button>
            </CardTitle>
            <CardDescription>
              This app is connected to project: {app.supabaseProjectName}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="supabase-branch-select">Database Branch</Label>
                <Select
                  value={app.supabaseProjectId || ""}
                  onValueChange={async (supabaseBranchProjectId) => {
                    try {
                      const branch = branches.find(
                        (b) => b.projectRef === supabaseBranchProjectId,
                      );
                      if (!branch) {
                        throw new Error("Branch not found");
                      }
                      await setAppProject({
                        projectId: branch.projectRef,
                        parentProjectId: branch.parentProjectRef,
                        appId,
                      });
                      toast.success("Branch selected");
                      await refreshApp();
                    } catch (error) {
                      toast.error("Failed to set branch: " + error);
                    }
                  }}
                  disabled={loading}
                >
                  <SelectTrigger
                    id="supabase-branch-select"
                    data-testid="supabase-branch-select"
                  >
                    <SelectValue placeholder="Select a branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem
                        key={branch.projectRef}
                        value={branch.projectRef}
                      >
                        {branch.name}
                        {branch.isDefault && " (Default)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button variant="destructive" onClick={handleUnsetProject}>
                Disconnect Project
              </Button>

              <SupabaseFunctionsOverview
                functionFolders={functionFolders}
                sharedModuleFiles={sharedModuleFiles}
              />
            </div>
          </CardContent>
        </Card>
      );
    }
    return (
      <Card className="mt-1">
        <CardHeader>
          <CardTitle>Supabase Projects</CardTitle>
          <CardDescription>
            Select a Supabase project to connect to this app
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : error ? (
            <div className="text-red-500">
              Error loading projects: {error.message}
              <Button
                variant="outline"
                className="mt-2"
                onClick={() => loadProjects()}
              >
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {projects.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No projects found in your Supabase account.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="project-select">Project</Label>
                    <Select
                      value={currentProjectId || ""}
                      onValueChange={handleProjectSelect}
                    >
                      <SelectTrigger id="project-select">
                        <SelectValue placeholder="Select a project" />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name || project.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {currentProjectId && (
                    <div className="text-sm text-gray-500">
                      This app is connected to project:{" "}
                      {projects.find((p) => p.id === currentProjectId)?.name ||
                        currentProjectId}
                    </div>
                  )}
                </>
              )}
              <SupabaseFunctionsOverview
                functionFolders={functionFolders}
                sharedModuleFiles={sharedModuleFiles}
              />
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col space-y-4 p-4 border rounded-md">
      <div className="flex flex-col md:flex-row items-center justify-between">
        <h2 className="text-lg font-medium">Integrations</h2>
        <img
          onClick={async () => {
            if (settings?.isTestMode) {
              await IpcClient.getInstance().fakeHandleSupabaseConnect({
                appId,
                fakeProjectId: "fake-project-id",
              });
            } else {
              await IpcClient.getInstance().openExternalUrl(
                "https://supabase-oauth.dyad.sh/api/connect-supabase/login",
              );
            }
          }}
          src={isDarkMode ? connectSupabaseDark : connectSupabaseLight}
          alt="Connect to Supabase"
          className="w-full h-10 min-h-8 min-w-20 cursor-pointer"
          data-testid="connect-supabase-button"
          // className="h-10"
        />
      </div>
    </div>
  );
}

interface SupabaseFunctionsOverviewProps {
  functionFolders: string[];
  sharedModuleFiles: string[];
}

function SupabaseFunctionsOverview({
  functionFolders,
  sharedModuleFiles,
}: SupabaseFunctionsOverviewProps) {
  const hasFunctions = functionFolders.length > 0;
  const hasSharedModules = sharedModuleFiles.length > 0;

  if (!hasFunctions && !hasSharedModules) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        No Supabase Edge function code yet. Create folders under
        <code className="mx-1">supabase/functions</code> or helpers inside
        <code className="mx-1">supabase/functions/_shared</code> to get started.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/40 p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Supabase Edge function overview</p>
        <p className="text-xs text-muted-foreground">
          Files inside
          <code className="mx-1">supabase/functions/_shared</code>
          are bundled into every deployed function, so Dyad and you can reuse
          helpers across all Edge functions.
        </p>
      </div>

      {hasFunctions && (
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Function folders
          </div>
          <div className="flex flex-wrap gap-1">
            {functionFolders.map((folder) => (
              <Badge key={folder} variant="secondary">
                {folder}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Shared modules
        </div>
        {hasSharedModules ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {sharedModuleFiles.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            No shared helpers yet. Add files under
            <code className="mx-1">_shared</code> to make utilities available to
            every function.
          </p>
        )}
      </div>
    </div>
  );
}
