import * as vscode from 'vscode';
import { getConfiguration } from '../configuration';
import { ErrorDiagnosticCollection, outputChannel } from '../extension';
import { readBuffer } from '../helpers';
import { parsePlan } from '../plan-parser';
import { Index } from './index';
import { IndexLocator } from './index-locator';

async function updateDocument(index: Index, uri: vscode.Uri): Promise<void> {
  return await vscode.workspace.openTextDocument(uri).then((doc) => {
    if (doc.isDirty || doc.languageId !== "terraform") {
      // ignore
      return;
    }

    try {
      if (!index.indexDocument(doc, { exclude: getConfiguration().indexing.exclude })) {
        outputChannel.appendLine(`terraform.crawler: Index not generated for: ${uri.toString()}`);
      } else {
        outputChannel.appendLine(`terraform.crawler: Indexed ${uri.toString()}`);
      }

    } catch (e) {
      outputChannel.appendLine(`terraform.crawler: Could not index template file: ${e}`);

      let range = new vscode.Range(0, 0, 0, 300);
      let diagnostics = new vscode.Diagnostic(range, `Unhandled error parsing document: ${e}`, vscode.DiagnosticSeverity.Error);

      ErrorDiagnosticCollection.set(uri, [diagnostics]);
    }
  });
}

async function updatePlanDocument(index: Index, uri: vscode.Uri): Promise<void> {
  try {
    const buffer = await readBuffer(uri.fsPath);
    const plan = parsePlan(buffer);
    if (!index.indexPlanFile(uri, plan, { exclude: getConfiguration().indexing.exclude })) {
      outputChannel.appendLine(`terraform.crawler: Index not generated for: ${uri.toString()}`);
    } else {
      outputChannel.appendLine(`terraform.crawler: Indexed ${uri.toString()}`);
    }
  } catch (e) {
    outputChannel.appendLine(`terraform.crawler: Could not parse plan file: ${e}`);
  }
}

function update(indexLocator: IndexLocator, uri: vscode.Uri): Promise<void> {
  let index = indexLocator.getIndexForUri(uri);
  if (!index) {
    outputChannel.appendLine(`terraform.crawler: Cannot locate index for ${uri.toString()}`);
    return;
  }

  if (uri.fsPath.endsWith(".tfplan"))
    return updatePlanDocument(index, uri);

  return updateDocument(index, uri);
}

export function createWorkspaceWatcher(indexLocator: IndexLocator): vscode.FileSystemWatcher {
  let watcher = vscode.workspace.createFileSystemWatcher("**/*.{tf,tfvars,tfplan}");
  watcher.onDidChange((uri) => { update(indexLocator, uri) });
  watcher.onDidCreate((uri) => { update(indexLocator, uri) });
  watcher.onDidDelete((uri) => {
    if (uri.fsPath.endsWith(".tfplan"))
      indexLocator.getIndexForUri(uri).deletePlan(uri);
    else
      indexLocator.getIndexForUri(uri).delete(uri)
  });
  return watcher;
}

export function initialCrawl(indexLocator: IndexLocator): Thenable<vscode.Uri[]> {
  outputChannel.appendLine("terraform.crawler: Crawling workspace for terraform files...");
  return vscode.workspace.findFiles("**/*.{tf,tfvars,tfplan}")
    .then((uris) => {
      return vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: "Indexing terraform templates"
      }, async (progress) => {
        for (let uri of uris) {
          progress.report({ message: `Indexing ${uri.toString()}` });
          await update(indexLocator, uri);
        }

        return uris;
      });
    });
}