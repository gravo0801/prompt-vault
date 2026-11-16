/* Shared GitHub data store. No credentials are included in this application. */
(function (root) {
  'use strict';
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function validate(data) {
    if (!Array.isArray(data)) throw new Error('공통 데이터 형식이 올바르지 않습니다.');
    const ids = new Set();
    for (const p of data) {
      if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id) || typeof p.prompt !== 'string' || typeof p.title !== 'string' || (p.images && !Array.isArray(p.images)) || (p.tags && !Array.isArray(p.tags))) throw new Error('중복 ID 또는 잘못된 프롬프트 데이터입니다.');
      ids.add(p.id);
    }
    return data;
  }
  function changes(base, local) {
    const a = new Map(base.map(p => [p.id, p]));
    const b = new Map(local.map(p => [p.id, p]));
    return [...new Set([...a.keys(), ...b.keys()])].filter(id => !same(a.get(id), b.get(id))).map(id => ({id, before:a.get(id), after:b.get(id)}));
  }
  function merge(remote, edits) {
    const result = new Map(remote.map(p => [p.id, p]));
    for (const edit of edits) {
      const current = result.get(edit.id);
      if (same(current, edit.after)) continue;
      if (!same(current, edit.before)) throw new Error('같은 프롬프트가 다른 기기에서 변경되었습니다. 대기 변경을 다운로드한 후 공통 자료를 다시 불러와 병합해 주세요.');
      if (edit.after) result.set(edit.id, edit.after); else result.delete(edit.id);
    }
    return validate([...result.values()]);
  }
  class GitHubStore {
    constructor(token = '') { this.token = token; }
    async request(path, options = {}) {
      const headers = {Accept:'application/vnd.github+json', ...(this.token ? {Authorization:'Bearer ' + this.token} : {}), ...options.headers};
      const response = await fetch('https://api.github.com/repos/gravo0801/prompt-vault/' + path, {...options, headers, cache:'no-store', signal:AbortSignal.timeout(30000)});
      if (!response.ok) {
        if (response.status === 409 || response.status === 422) throw new Error('저장 중 다른 기기의 변경이 감지되었습니다. 다시 동기화해 주세요.');
        if (response.status === 401) throw new Error('GitHub 연결 정보가 만료되었거나 잘못되었습니다.');
        if (response.status === 403 || response.status === 429) throw new Error('GitHub 요청 제한 또는 쓰기 권한을 확인해 주세요. 잠시 후 다시 동기화할 수 있습니다.');
        throw new Error('공통 저장소 연결 실패 (' + response.status + ')');
      }
      return response;
    }
    async read(knownSha, knownData) {
      const info = await (await this.request('contents/prompts.json?ref=main&t=' + Date.now(), {headers:{Accept:'application/vnd.github.object+json'}})).json();
      if (!info.sha) throw new Error('공통 데이터 버전을 확인할 수 없습니다.');
      if (info.sha === knownSha && knownData) return {sha:info.sha, data:knownData};
      // Immutable blob reads also support files larger than the Contents API's 1 MB inline limit.
      const data = await (await this.request('git/blobs/' + info.sha, {headers:{Accept:'application/vnd.github.raw+json'}})).json();
      return {sha:info.sha, data:validate(data)};
    }
    async write(data, sha) {
      if (!this.token) throw new Error('공통 저장에는 GitHub 편집 연결이 필요합니다.');
      validate(data);
      const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2) + '\n');
      let binary = '';
      for (let i=0; i<bytes.length; i+=32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768));
      const result = await (await this.request('contents/prompts.json', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:'Update shared prompts from Prompt Vault', branch:'main', sha, content:btoa(binary)})})).json();
      return result.content.sha;
    }
  }
  root.VaultSync = {validate, changes, merge, GitHubStore};
})(typeof window === 'undefined' ? globalThis : window);
