import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { concatMap, first, map } from 'rxjs/operators';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { ClickUpApiService } from './clickup-api.service';
import { ClickUpCfg } from './clickup.model';
import { IssueData, SearchResultItem } from '../../issue.model';
import { ClickUpTask, ClickUpTaskReduced } from './clickup-issue.model';
import {
  mapClickUpAttachmentToTaskAttachment,
  mapClickUpTaskToTask,
  isClickUpTaskDone,
} from './clickup-issue-map.util';
import { Task } from '../../../tasks/task.model';
import { TaskAttachment } from '../../../tasks/task-attachment/task-attachment.model';
import { truncate } from '../../../../util/truncate';

@Injectable({
  providedIn: 'root',
})
export class ClickUpCommonInterfacesService extends BaseIssueProviderService<ClickUpCfg> {
  private _clickUpApiService = inject(ClickUpApiService);

  readonly providerKey = 'CLICKUP' as const;
  readonly pollInterval = 60000;

  isEnabled(cfg: ClickUpCfg): boolean {
    return !!cfg && cfg.isEnabled && !!cfg.apiKey;
  }

  testConnection(cfg: ClickUpCfg): Promise<boolean> {
    return firstValueFrom(
      this._clickUpApiService.getCurrentUser$(cfg).pipe(
        map(() => true),
        first(),
      ),
    )
      .then((result) => result ?? false)
      .catch(() => false);
  }

  // Fetches the issue to get the URL
  override issueLink(issueId: string, issueProviderId: string): Promise<string> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        concatMap((cfg) =>
          this._clickUpApiService.getById$(issueId, cfg).pipe(map((issue) => issue.url)),
        ),
        first(),
      ),
    ).then((res) => res ?? '');
  }

  getAddTaskData(issue: ClickUpTaskReduced): Partial<Task> & { title: string } {
    return {
      title: issue.name,
      issueWasUpdated: false,
      issueLastUpdated: parseInt(issue.date_updated, 10),
      isDone: isClickUpTaskDone(issue),
    };
  }

  getMappedAttachments(issue: ClickUpTask): TaskAttachment[] {
    return (issue.attachments || []).map(mapClickUpAttachmentToTaskAttachment);
  }

  getSubTasksForIssue(
    issue: ClickUpTask,
  ): Array<Partial<Task> & { title: string; related_to: string }> {
    if (!issue.subtasks || issue.subtasks.length === 0) {
      return [];
    }

    return issue.subtasks.map((subtask) => ({
      title: subtask.name,
      issueWasUpdated: false,
      issueLastUpdated: parseInt(subtask.date_updated, 10),
      isDone: isClickUpTaskDone(subtask),
      related_to: issue.id,
      issueId: subtask.id,
      issueType: 'CLICKUP' as const,
    }));
  }

  async getSubTasks(
    issueId: string | number,
    issueProviderId: string,
    issue: ClickUpTaskReduced,
  ): Promise<ClickUpTaskReduced[]> {
    let subtasks = (issue as ClickUpTask).subtasks;

    if (!subtasks) {
      const fullIssue = (await this.getById(
        issueId.toString(),
        issueProviderId,
      )) as ClickUpTask;
      subtasks = fullIssue.subtasks;
    }

    if (subtasks) {
      return subtasks.filter((subtask) => subtask.status?.type !== 'closed');
    }
    return [];
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: (string | number)[],
  ): Promise<ClickUpTaskReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    const tasks = await firstValueFrom(
      this._clickUpApiService.searchTasks$('', cfg).pipe(first()),
    );

    return tasks.filter((task) => !allExistingIssueIds.includes(task.id));
  }

  // Uses mapClickUpTaskToTask for richer field mapping
  override async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: ClickUpTask;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId || !task.issueId) {
      throw new Error('No issueProviderId or issueId');
    }

    const cfg = await firstValueFrom(this._getCfgOnce$(task.issueProviderId));
    const issue = await firstValueFrom(
      this._clickUpApiService.getById$(task.issueId, cfg),
    );

    const issueLastUpdated = parseInt(issue.date_updated, 10);
    const wasUpdated = issueLastUpdated > (task.issueLastUpdated || 0);

    if (wasUpdated) {
      return {
        taskChanges: {
          ...mapClickUpTaskToTask(issue),
          issueWasUpdated: true,
        },
        issue,
        issueTitle: truncate(issue.name),
      };
    }

    return null;
  }

  protected _apiGetById$(
    id: string | number,
    cfg: ClickUpCfg,
  ): Observable<IssueData | null> {
    return this._clickUpApiService.getById$(id.toString(), cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: ClickUpCfg,
  ): Observable<SearchResultItem[]> {
    return this._clickUpApiService.searchTasks$(searchTerm, cfg).pipe(
      map((tasks) =>
        tasks.map((t) => ({
          title: t.name,
          issueType: 'CLICKUP' as const,
          issueData: t,
        })),
      ),
    );
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return truncate((issue as ClickUpTask).name);
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return parseInt((issue as ClickUpTask).date_updated, 10);
  }
}
