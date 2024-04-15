import { LightningElement, api } from 'lwc';

export default class FlowVersionCleaner extends LightningElement {
    @api sessionId;

    selectedFlow;
    selectedFlowRows;
    filteredFlowName;
    flowVersionsOfSelectedFlow;
    selectedFlowVersionRows;
    selectedFlowVersionRowKeys;
    disableDeleteFlowVersionsButton;
    disableOpenFlowVersionsButton = true;
    isLoading = true;
    columns = {
        active: [
            {
                label: 'Flow Label',
                fieldName: 'flowUrl',
                type: 'url',
                typeAttributes: {
                    label: {
                        fieldName: 'label'
                    }
                }
            }, {
                label: 'Active Version',
                fieldName: 'VersionNumber'
            },{
                label: 'Process Type',
                fieldName: 'ProcessType'
            }, {
                label: 'Template',
                fieldName: 'IsTemplate',
                type: 'boolean'
            }, {
                label: 'Package State',
                fieldName: 'ManageableState'
            }, {
                label: 'Package Namespace',
                fieldName: 'NamespacePrefix'
            }
        ],
        versions: [
            {
                label: 'Version Number',
                fieldName: 'flowUrl',
                type: 'url',
                typeAttributes: {
                    label: {
                        fieldName: 'VersionNumber'
                    }
                }
            }, {
                label: 'Status',
                fieldName: 'Status'
            }, {
                label: 'Created Date',
                fieldName: 'CreatedDate',
                type: 'date',
                typeAttributes: {
                    day: 'numeric',
                    month: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                }
            }
        ]
    };

    async connectedCallback() {
        const lastModifiedFields = [{
            label: 'Last Modified By',
            fieldName: 'lastModifiedByUrl',
            type: 'url',
            typeAttributes: {
                label: {
                    fieldName: 'lastModifiedByName'
                }
            }
        }, {
            label: 'Last Modified Date',
            fieldName: 'LastModifiedDate',
            type: 'date',
            typeAttributes: {
                day: 'numeric',
                month: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }
        }];

        const { sessionId, columns: { active, versions } } = this;
        Object.assign(this, {
            flowInterviewIdPrefix: '0Fo',
            dataServicesUrl: `${window.location.origin}/services/data/v53.0`,
            headers: { Authorization: `Bearer ${sessionId}`, 'Content-Type': 'application/json' },
            columns: { active: [...active, ...lastModifiedFields], versions: [...versions, ...lastModifiedFields] }
        });

        await this.refreshFlows();
    }

    handleFilterByNameChange({ detail: { value } }) {
        if(value) {
            clearTimeout(this.typingTimer);
            this.typingTimer = setTimeout(() => {
                this.typingTimer = undefined;
                this.filteredFlowName = value?.toLowerCase();
            }, 300);
        } else {
            this.filteredFlowName = undefined;
        }
    }

    getSelectedFlow({ detail: { selectedRows: [selectedFlow] } }) {
        Object.assign(this, { selectedFlow, selectedFlowRows: [selectedFlow.Id], disableOpenFlowVersionsButton: false });
    }

    getSelectedFlowVersionRows({ detail: { selectedRows } }) {
        Object.assign(this, {
            selectedFlowVersionRows: selectedRows,
            selectedFlowVersionRowKeys: selectedRows.map(({ Id }) => Id),
            disableDeleteFlowVersionsButton: !selectedRows.length
        });

        console.log('selectedRows:', JSON.stringify(selectedRows, null, 4));
        console.log('selectedFlowVersionRowKeys:', JSON.stringify(this.selectedFlowVersionRowKeys, null, 4));
    }

    handleOpenVersionsModalButton() {
        const { DeveloperName: selectedFlowDeveloperName } = this.selectedFlow;
        const selectedRows = this.records.filter(({ Status, Definition: { DeveloperName } }) => DeveloperName === selectedFlowDeveloperName && Status !== 'Active').map(flowVersion => {
            const { Id, LastModifiedById, LastModifiedBy, DefinitionId } = flowVersion;
            return {
                ...flowVersion,
                lastModifiedByName: LastModifiedBy?.Name || LastModifiedById,
                lastModifiedByUrl: `/${LastModifiedById}`,
                flowUrl: `/builder_platform_interaction/flowBuilder.app?isFromAloha=true&flowDefId=${DefinitionId}&flowId=${Id}`
            };
        });

        this.flowVersionsOfSelectedFlow = selectedRows;
        this.getSelectedFlowVersionRows({ detail: { selectedRows } });
    }

    closeModal() {
        Object.assign(this, { flowVersionsOfSelectedFlow: null, selectedFlowVersionRows: null });
    }

    handleInputChange({ target, target: { name, type, checked, value } }) {
        console.log('name:', name, 'type:', type, 'value:', target.value, 'checked:', target.checked);
        this[name] = type === 'checkbox' ? checked : value;
    }

    async callApi(endpoint, method) {
        this.isLoading = true;
        try {
            const response = await fetch(this.dataServicesUrl + endpoint, { method, headers: this.headers });
            console.log('response:', JSON.stringify(response, null, 4));
            const result = { ok: response.ok, statusCode: response.status, statusMessage: response.statusText };
            try {
                result.body = await response.json();
            } catch(error) {
                // ignore empty body exception
            }

            console.log('result:', JSON.stringify(result, null, 4));
            return result;
        } catch(error) {
            console.error(error);
            throw error;
        }
    }

    async toolingQuery(query) {
        try {
            console.log('query:', `/query?q=${query.replaceAll(' ', '+')}`);
            const { ok, statusCode, statusMessage, body } = await   this.callApi(`/tooling/query?q=${query.replaceAll(' ', '+')}`, 'GET');
            if(!ok) {
                throw new Error(`tooling api failed with code ${statusCode}\nmessage: ${statusMessage}\nbody: ${JSON.stringify(body, null, 4)}`);
            }

            return body;
        } catch(error) {
            this.isLoading = false;
        }
    }

    async handleDeleteButton() {
        this.isLoading = true;
        console.log('flowVersions:', JSON.stringify(this.flowVersions, null, 4));
        const deleteFlowVersionPromises = await Promise.allSettled(this.selectedFlowVersionRows.reduce((promises, flow) => [...promises, this.deleteEntity(flow, '/tooling')], []));
        console.log('flow versions have been deleted');
        const failedFlowDeletes = deleteFlowVersionPromises.filter(({ status }) => status === 'rejected');
        if(failedFlowDeletes.length) {
            await this.handleFailedFlowDeletes(failedFlowDeletes);
        }

        this.closeModal();
        this.refreshFlows();
    }

    async handleFailedFlowDeletes(failedFlowDeletes) {
        console.log('handleFailedFlowDeletes:', failedFlowDeletes);
        const { flowsToDeleteLater, flowInterviewIdsToDelete } = this.getFlowInterviewIdsFromFailedFlowDeleteResponses(failedFlowDeletes);
        console.log('flowInterviewIdsToDelete:', JSON.stringify(flowInterviewIdsToDelete, null, 4));

        const deletedFlowInterviewsResult = await Promise.all(flowInterviewIdsToDelete.reduce((promises, Id) => {
            console.log('adding deleteEntity promise for flow interview:', JSON.stringify({ Id, attributes: { type: 'FlowInterview' } }, null, 4));
            return [...promises, this.deleteEntity({ Id, attributes: { type: 'FlowInterview' } })];
        }, []));
        console.log('flow interviews have been deleted', JSON.stringify(deletedFlowInterviewsResult, null, 4));
        await Promise.all(flowsToDeleteLater.reduce((promises, flow) => [...promises, this.deleteEntity(flow, '/tooling')], []));
        console.log('rest of flow versions have been deleted');
    }

    getFlowInterviewIdsFromFailedFlowDeleteResponses(failedFlowDeletes) {
        return failedFlowDeletes.reduce(({ flowInterviewIdsToDelete, flowsToDeleteLater }, { reason: { message } }) => {
            //console.log('reason:', reason, 'typeof:', typeof reason);
            console.log('message:', message);
            const { errors, entity }  = JSON.parse(message);
            return {
                flowInterviewIdsToDelete: [...flowInterviewIdsToDelete, ...this.extractFlowInterviewIdsFromErrorMessages(errors)],
                flowsToDeleteLater: [...flowsToDeleteLater, entity]
            };
        }, { flowInterviewIdsToDelete: [], flowsToDeleteLater: [] });
    }

    extractFlowInterviewIdsFromErrorMessages(errors) {
        return errors.reduce((parsedFlowInterviewIds, { message, errorCode }) => {
            if(errorCode === 'DEPENDENCY_EXISTS') {
                return [...parsedFlowInterviewIds, ...new Set([...message.matchAll(new RegExp(this.flowInterviewIdPrefix, 'gi'))].map(({ index }) => message.substring(index, index + 15)))];
            }

            throw new Error(`${errorCode} - ${message}`);
        }, []);
    }

    get filteredFlows() {
        const { filteredFlowName, activeFlows } = this;
        return filteredFlowName ? activeFlows.filter(({ label }) => label.toLowerCase().includes(filteredFlowName)) : activeFlows;
    }

    async refreshFlows() {
        try {
            this.isLoading = true;
            const { records } = await this.toolingQuery("SELECT Id,Status,VersionNumber,ProcessType,IsTemplate,ManageableState,MasterLabel,CreatedDate,LastModifiedDate,LastModifiedById,LastModifiedBy.Name,DefinitionId,Definition.DeveloperName,Definition.NamespacePrefix FROM Flow WHERE Definition.ActiveVersionId != NULL ORDER BY LastModifiedDate DESC");
            this.records = records;
            this.selectedFlow = null;
            this.selectedFlowRows = [];
            this.disableOpenFlowVersionsButton = true;
            this.activeFlows = records.filter(({ Status }) => Status === 'Active').map(flow => {
                const { Id, LastModifiedById, LastModifiedBy, MasterLabel, DefinitionId, Definition: { DeveloperName, NamespacePrefix } } = flow;
                return {
                    ...flow,
                    DeveloperName,
                    NamespacePrefix,
                    label: `${MasterLabel} (${DeveloperName})`,
                    lastModifiedByName: LastModifiedBy?.Name || LastModifiedById,
                    lastModifiedByUrl: `/${LastModifiedById}`,
                    flowUrl: `/builder_platform_interaction/flowBuilder.app?isFromAloha=true&flowDefId=${DefinitionId}&flowId=${Id}`
                };
            });
        } catch(error) {
            console.error(error);
        }

        this.isLoading = false;

        console.log('activeFlows:', JSON.stringify(this.activeFlows, null, 4));
    }

    async deleteEntity(entity, prefix = '') {
        const { Id, attributes: { type } } = entity;
        console.log(`deleteEntity(${JSON.stringify(entity)})`);
        const { ok, statusCode, statusMessage, body } = await this.callApi(`${prefix}/sobjects/${type}/${Id}`, 'DELETE');
        if(!ok) {
            const bodyStr = JSON.stringify({ entity, errors: body }, null, 4);
            console.log(`delete request failed with status code ${statusCode}\nmessage: ${statusMessage}\nbody: ${bodyStr}`);
            throw new Error(bodyStr);
        }

        return entity;
    }
}