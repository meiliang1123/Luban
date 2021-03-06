import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import i18n from '../../../lib/i18n';
import { MACHINE_SERIES } from '../../../constants';
import {
    CaseConfigOriginal, CaseConfig150,
    CaseConfig250, CaseConfig350,
    CaseConfigA350FourAxis, CaseConfigA250FourAxis
} from './CaseConfig';
import { timestamp } from '../../../../shared/lib/random-utils';
import { actions as projectActions } from '../../../flux/project';
import styles from './styles.styl';

const QuickStart = (props) => {
    const { history } = props;
    // useState
    const [caseConfig, setCaseConfig] = useState([]);
    const [caseConfigFourAxis, setCaseConfigFourAxis] = useState([]);

    // redux correlation
    const series = useSelector(state => state?.machine?.series);
    const use4Axis = useSelector(state => state?.machine?.use4Axis);
    const dispatch = useDispatch();

    //  method
    const getCaseList = () => {
        switch (series) {
            case MACHINE_SERIES.ORIGINAL.value:
            case MACHINE_SERIES.CUSTOM.value:
                setCaseConfig(CaseConfigOriginal);
                break;
            case MACHINE_SERIES.A150.value:
                setCaseConfig(CaseConfig150);
                break;
            case MACHINE_SERIES.A250.value:
                setCaseConfig(CaseConfig250);
                setCaseConfigFourAxis(CaseConfigA250FourAxis);
                break;
            case MACHINE_SERIES.A350.value:
                setCaseConfig(CaseConfig350);
                setCaseConfigFourAxis(CaseConfigA350FourAxis);
                break;
            default:
                setCaseConfig(CaseConfig150);
                setCaseConfigFourAxis([]);
                break;
        }
    };

    const loadCase = (caseItem) => {
        dispatch(projectActions.openProject(caseItem.pathConfig, history));
    };

    //  useEffect
    useEffect(() => {
        getCaseList();
    }, []);

    useEffect(() => {
        getCaseList();
    }, [series]);

    return (
        <div className={styles['quick-start-container']}>
            <div className={styles['title-label']}>
                {i18n._('Fast Start')}
            </div>
            <div className={
                classNames(
                    styles['case-list'],
                    { [styles.smallList]: !caseConfigFourAxis.length }
                )}
            >
                {caseConfig.map(caseItem => {
                    return (
                        <div
                            key={caseItem.pathConfig.name + timestamp()}
                            className={styles['case-item']}
                            aria-hidden="true"
                            onClick={() => loadCase(caseItem)}
                        >
                            <div>
                                <img className={styles['case-img']} src={caseItem.imgSrc} alt="" />
                                <span className={styles['tag-icon']}>
                                    {i18n._(caseItem.tag_i18n)}
                                </span>
                            </div>
                            <div className={styles['case-title']}>
                                {caseItem.title}
                            </div>
                        </div>
                    );
                })}
                {use4Axis && caseConfigFourAxis?.map(caseFourAxisItem => {
                    return (
                        <div
                            key={caseFourAxisItem.pathConfig.name + timestamp()}
                            className={styles['case-item']}
                            aria-hidden="true"
                            onClick={() => loadCase(caseFourAxisItem)}
                        >
                            <div>
                                <img className={styles['case-img']} src={caseFourAxisItem.imgSrc} alt="" />
                                <span className={styles['tag-icon']}>
                                    <span style={{ paddingRight: 2 }}>{i18n._('4-axis')}</span>
                                    <span>{i18n._(caseFourAxisItem.tag_i18n)}</span>
                                </span>
                            </div>
                            <div className={styles['case-title']}>
                                {caseFourAxisItem.title}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

QuickStart.propTypes = {
    history: PropTypes.object
};

export default QuickStart;
